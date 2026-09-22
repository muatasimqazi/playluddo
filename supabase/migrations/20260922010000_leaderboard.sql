-- Tracks total wins per signed-in player. Anonymous (guest) accounts never
-- accrue a row here -- see private.leaderboard_on_match_completed below.
create table public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wins integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.player_stats enable row level security;

revoke all on public.player_stats from anon, authenticated;

-- Fires once per real match completion, regardless of which game type or
-- rules-engine function caused the transition -- keyed on the same
-- status/match_end_reason convention every win path already uses to show
-- the summary screen, not on any individual RPC. winner_ids is finish
-- order (see 20260918010000_continue_after_first_winner.sql); [1] is 1st
-- place. A rematch resets status to 'lobby' first (m4_rematch.sql), so it
-- can never double-count.
create or replace function private.leaderboard_on_match_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_winner_user_id uuid;
begin
  if new.winner_ids is null or array_length(new.winner_ids, 1) is null then
    return new;
  end if;

  select p.user_id into v_winner_user_id
  from public.players p
  where p.id = new.winner_ids[1];

  if v_winner_user_id is not null
     and exists (
       select 1 from auth.users u
       where u.id = v_winner_user_id and u.is_anonymous = false
     )
  then
    insert into public.player_stats (user_id, wins)
    values (v_winner_user_id, 1)
    on conflict (user_id) do update
      set wins = public.player_stats.wins + 1, updated_at = now();
  end if;

  return new;
end;
$$;

revoke execute on function private.leaderboard_on_match_completed() from public;

create trigger leaderboard_on_match_completed
after update on public.rooms
for each row
when (
  old.status is distinct from 'summary'
  and new.status = 'summary'
  and new.match_end_reason = 'completed'
)
execute function private.leaderboard_on_match_completed();

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
      coalesce(u.raw_user_meta_data ->> 'display_name', 'Player') as display_name,
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

create or replace function public.get_leaderboard(p_team_id uuid default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_member_ids uuid[];
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'INVALID_LIMIT'; end if;

  if p_team_id is not null then
    if not exists (
      select 1 from public.team_members
      where team_id = p_team_id and user_id = v_user_id
    ) then
      raise exception 'NOT_TEAM_MEMBER';
    end if;
    select array_agg(user_id) into v_member_ids
    from public.team_members where team_id = p_team_id;
    return private.leaderboard_json(v_member_ids, p_limit);
  end if;

  return private.leaderboard_json(null, p_limit);
end;
$$;

revoke execute on function public.get_leaderboard(uuid, int) from public, anon;
grant execute on function public.get_leaderboard(uuid, int) to authenticated;

-- The caller's own win count, independent of get_leaderboard's limit --
-- a player ranked below the top p_limit would otherwise be unreachable.
create or replace function public.get_my_wins()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select wins from public.player_stats where user_id = (select auth.uid())),
    0
  );
$$;

revoke execute on function public.get_my_wins() from public, anon;
grant execute on function public.get_my_wins() to authenticated;
