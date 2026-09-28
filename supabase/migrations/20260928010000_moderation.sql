-- Player safety for user-generated content (App Store guideline 1.2): table
-- chat and names are filtered, players can report and block each other, and
-- reports are kept for review (Supabase dashboard → player_reports).

-- ---------------------------------------------------------------------------
-- Filter: mask common profanity and slurs in chat, seat names and
-- leaderboard names. Word-start anchored (\m) so ordinary words that merely
-- contain these letters ("cockpit", "Dickens") are left alone.
create or replace function private.clean_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    p_text,
    '\m(\w*fuck\w*|motherf\w*|shit\w*|bullshit\w*|bitch\w*|cunts?|dicks?|dickhead\w*|cocks?|cocksucker\w*|puss(y|ies)|assholes?|arsehole\w*|bastards?|sluts?|whores?|fags?|faggots?|nigg(er|a|ers|as|az)|retards?|retarded|rapists?|kikes?|spics?|chinks?|wetbacks?|trann(y|ies)|twats?|wank\w*)\M',
    '****',
    'gi'
  );
$$;
revoke execute on function private.clean_text(text) from public;

create or replace function private.clean_table_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'chat' then new.text := private.clean_text(new.text); end if;
  return new;
end;
$$;
create trigger table_messages_clean before insert on public.table_messages
for each row execute function private.clean_table_message();

create or replace function private.clean_player_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_name := private.clean_text(new.display_name);
  return new;
end;
$$;
create trigger players_clean_name before insert or update of display_name on public.players
for each row execute function private.clean_player_name();

-- The global leaderboard shows profile names to everyone.
create or replace function private.leaderboard_json(p_user_ids uuid[], p_limit int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rank', ranked.rank,
    'userId', ranked.user_id,
    'displayName', ranked.display_name,
    'avatarId', ranked.avatar_id,
    'wins', ranked.wins
  ) order by ranked.rank), '[]'::jsonb)
  from (
    select
      row_number() over (order by ps.wins desc, ps.updated_at asc) as rank,
      ps.user_id,
      ps.wins,
      private.clean_text(coalesce(u.raw_user_meta_data ->> 'display_name', 'Player')) as display_name,
      u.raw_user_meta_data ->> 'avatar_id' as avatar_id
    from public.player_stats ps
    join auth.users u on u.id = ps.user_id
    where ps.wins > 0
      and (p_user_ids is null or ps.user_id = any(p_user_ids))
    order by ps.wins desc, ps.updated_at asc
    limit p_limit
  ) ranked;
$$;
revoke execute on function private.leaderboard_json(uuid[], int) from public;

-- ---------------------------------------------------------------------------
-- Blocks: by account, so a block follows the person to any future table.
-- Blocked players' chat and reactions are hidden and their voice is muted
-- for the blocker (client side, via blocked_player_ids).
create table public.player_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);
alter table public.player_blocks enable row level security;
revoke all on public.player_blocks from anon, authenticated;

-- Reports: reviewed by the operator (no client access). recent_messages is a
-- snapshot of the reported player's latest chat at that table, so the
-- evidence survives the table being cleaned up.
create table public.player_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid references auth.users(id) on delete set null,
  reported_user_id uuid references auth.users(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  reported_player_id uuid,
  reported_display_name text not null,
  reason text not null check (reason in ('harassment', 'hate', 'sexual', 'spam', 'cheating', 'other')),
  details text check (details is null or char_length(details) <= 500),
  recent_messages jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);
create index player_reports_open on public.player_reports (created_at desc) where status = 'open';
alter table public.player_reports enable row level security;
revoke all on public.player_reports from anon, authenticated;

-- The account behind another human seat at a table the caller sits at.
create or replace function private.ludo_other_player_user(p_room_id uuid, p_player_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  if private.ludo_caller_player_id(p_room_id) is null then raise exception 'SEAT_NOT_CONTROLLED'; end if;
  select p.user_id into v_user
  from public.players p
  where p.id = p_player_id and p.room_id = p_room_id and not p.is_bot;
  if v_user is null or v_user = (select auth.uid()) then raise exception 'PLAYER_NOT_FOUND'; end if;
  return v_user;
end;
$$;
revoke execute on function private.ludo_other_player_user(uuid, uuid) from public;

create or replace function public.set_player_blocked(p_room_id uuid, p_player_id uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := private.ludo_other_player_user(p_room_id, p_player_id);
begin
  if p_blocked then
    insert into public.player_blocks (blocker_user_id, blocked_user_id)
    values ((select auth.uid()), v_target)
    on conflict do nothing;
  else
    delete from public.player_blocks
    where blocker_user_id = (select auth.uid()) and blocked_user_id = v_target;
  end if;
end;
$$;
revoke execute on function public.set_player_blocked(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_player_blocked(uuid, uuid, boolean) to authenticated;

-- Seats at this table held by people the caller has blocked.
create or replace function public.blocked_player_ids(p_room_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}')
  from public.players p
  join public.player_blocks b
    on b.blocked_user_id = p.user_id and b.blocker_user_id = (select auth.uid())
  where p.room_id = p_room_id
    and private.ludo_caller_player_id(p_room_id) is not null;
$$;
revoke execute on function public.blocked_player_ids(uuid) from public, anon;
grant execute on function public.blocked_player_ids(uuid) to authenticated;

create or replace function public.report_player(
  p_room_id uuid,
  p_player_id uuid,
  p_reason text,
  p_details text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := private.ludo_other_player_user(p_room_id, p_player_id);
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if p_reason is null or p_reason not in ('harassment', 'hate', 'sexual', 'spam', 'cheating', 'other') then
    raise exception 'INVALID_REPORT';
  end if;
  if v_details is not null and char_length(v_details) > 500 then raise exception 'INVALID_REPORT'; end if;
  if (
    select count(*) from public.player_reports
    where reporter_user_id = (select auth.uid()) and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'You''ve sent several reports recently. Please try again later.';
  end if;
  insert into public.player_reports (
    reporter_user_id, reported_user_id, room_id, reported_player_id,
    reported_display_name, reason, details, recent_messages
  )
  select
    (select auth.uid()), v_target, p_room_id, p_player_id,
    p.display_name, p_reason, v_details,
    coalesce((
      select jsonb_agg(jsonb_build_object('text', m.text, 'createdAt', m.created_at) order by m.created_at)
      from (
        select text, created_at from public.table_messages
        where room_id = p_room_id and player_id = p_player_id and kind = 'chat'
        order by created_at desc limit 20
      ) m
    ), '[]'::jsonb)
  from public.players p
  where p.id = p_player_id;
end;
$$;
revoke execute on function public.report_player(uuid, uuid, text, text) from public, anon;
grant execute on function public.report_player(uuid, uuid, text, text) to authenticated;
