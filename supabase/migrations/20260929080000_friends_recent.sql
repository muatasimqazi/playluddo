-- Friends & who's online (F3.6) and Recently played (F3.7).
-- docs/COMPETITIVE_ROADMAP.md, Section 15 R3, R7, R10.
--
-- A friend graph filled by requests (by friend code, or "Add friend" on a
-- seat), respecting the moderation blocks (20260928010000_moderation.sql): a
-- block hides the person and prevents a friendship either way. Each friend's
-- currently-joinable table is reported the same way teams surface theirs
-- (20260919050000_team_active_room.sql), so a friend can be joined in one tap.
--
-- Recently played lists the accounts from the caller's last five tables, so
-- the home page can offer "play again with these people".
--
-- Deferred (dependencies): live "online now" presence dots (Supabase Realtime
-- Presence) and invite push notifications (F1.7, not built) — the joinable
-- table below already delivers the join-in-one-tap value without them.
--
-- Also flips on the F3.2 hook: playing alongside a friend earns bonus XP.

-- Stored as one row per pair, canonically ordered (low < high) so a pair is
-- unique regardless of who asked. requested_by records the direction while
-- a request is pending.
create table public.friendships (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low < user_high)
);

create index friendships_high_idx on public.friendships(user_high);
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;

-- A stable, shareable friend code per account.
create table public.friend_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique
);

alter table public.friend_codes enable row level security;
revoke all on public.friend_codes from anon, authenticated;

-- True when either account has blocked the other (20260928010000_moderation).
create or replace function private.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.player_blocks b
    where (b.blocker_user_id = p_a and b.blocked_user_id = p_b)
       or (b.blocker_user_id = p_b and b.blocked_user_id = p_a)
  );
$$;
revoke execute on function private.blocked_between(uuid, uuid) from public;

-- Are these two accounts accepted friends? Used by the XP bonus and lists.
create or replace function private.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and f.user_low = least(p_a, p_b)
      and f.user_high = greatest(p_a, p_b)
  );
$$;
revoke execute on function private.are_friends(uuid, uuid) from public;

-- The account's latest joinable table (a seat it holds in a lobby/in-game
-- room), or null. Mirrors the team activeRoom shape.
create or replace function private.user_active_room(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'roomId', r.id, 'code', r.code, 'status', r.status,
    'seatsTaken', (select count(*) from public.players pp where pp.room_id = r.id),
    'maxPlayers', r.max_players
  )
  from public.players p
  join public.rooms r on r.id = p.room_id
  where p.user_id = p_user_id
    and r.status in ('lobby', 'in_game')
    and not r.is_party
  order by r.created_at desc
  limit 1;
$$;
revoke execute on function private.user_active_room(uuid) from public;

create or replace function public.get_my_friend_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select code into v_code from public.friend_codes where user_id = v_uid;
  if v_code is not null then return v_code; end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.friend_codes (user_id, code) values (v_uid, v_code);
      return v_code;
    exception when unique_violation then
      -- Retry on the rare code collision.
    end;
  end loop;
end;
$$;
revoke execute on function public.get_my_friend_code() from public, anon;
grant execute on function public.get_my_friend_code() to authenticated;

-- Creates or accepts a friendship with another account. If they already asked
-- us, this accepts; otherwise it records a pending request from us.
create or replace function private.request_friend(p_target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_low uuid;
  v_high uuid;
  v_existing public.friendships;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_target is null or p_target = v_uid then raise exception 'INVALID_FRIEND'; end if;
  if private.blocked_between(v_uid, p_target) then raise exception 'BLOCKED'; end if;

  v_low := least(v_uid, p_target);
  v_high := greatest(v_uid, p_target);
  select * into v_existing from public.friendships where user_low = v_low and user_high = v_high;

  if v_existing.status = 'accepted' then
    return 'accepted';
  elsif v_existing.status = 'pending' then
    -- If the other person had asked us, this accepts. A repeat of our own
    -- pending request is a no-op.
    if v_existing.requested_by <> v_uid then
      update public.friendships set status = 'accepted', updated_at = now()
      where user_low = v_low and user_high = v_high;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  insert into public.friendships (user_low, user_high, status, requested_by)
  values (v_low, v_high, 'pending', v_uid);
  return 'pending';
end;
$$;
revoke execute on function private.request_friend(uuid) from public;

create or replace function public.send_friend_request(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  select user_id into v_target from public.friend_codes
  where code = upper(trim(p_code));
  if v_target is null then raise exception 'NO_SUCH_CODE'; end if;
  return private.request_friend(v_target);
end;
$$;
revoke execute on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;

-- "Add friend" on a seat: resolves the account behind a seat (players.id),
-- never exposing its id to the client.
create or replace function public.add_friend_from_seat(p_player_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
begin
  select user_id into v_target from public.players
  where id = p_player_id and is_bot = false;
  if v_target is null then raise exception 'NO_SUCH_PLAYER'; end if;
  if exists (select 1 from auth.users where id = v_target and is_anonymous = true) then
    raise exception 'GUEST_PLAYER';
  end if;
  return private.request_friend(v_target);
end;
$$;
revoke execute on function public.add_friend_from_seat(uuid) from public, anon;
grant execute on function public.add_friend_from_seat(uuid) to authenticated;

create or replace function public.respond_friend_request(p_friend uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_low uuid := least(v_uid, p_friend);
  v_high uuid := greatest(v_uid, p_friend);
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_accept then
    -- Only the person who received the request may accept it.
    update public.friendships set status = 'accepted', updated_at = now()
    where user_low = v_low and user_high = v_high
      and status = 'pending' and requested_by <> v_uid;
  else
    delete from public.friendships
    where user_low = v_low and user_high = v_high and status = 'pending';
  end if;
end;
$$;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

create or replace function public.remove_friend(p_friend uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships
  where user_low = least((select auth.uid()), p_friend)
    and user_high = greatest((select auth.uid()), p_friend);
$$;
revoke execute on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;

-- The caller's friends and pending requests, each with profile bits and their
-- joinable table. Blocked people are filtered out.
create or replace function public.get_friends()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', other,
      'displayName', coalesce(u.raw_user_meta_data ->> 'display_name', 'Player'),
      'avatarId', u.raw_user_meta_data ->> 'avatar_id',
      'level', coalesce((select level from public.player_progression pr where pr.user_id = other), 1),
      'status', f.status,
      -- For a pending row: 'incoming' if they asked us, 'outgoing' if we asked.
      'direction', case when f.status = 'pending'
        then case when f.requested_by = v_uid then 'outgoing' else 'incoming' end end,
      'activeRoom', private.user_active_room(other)
    ) order by (f.status = 'accepted') desc, u.raw_user_meta_data ->> 'display_name')
    from public.friendships f
    cross join lateral (
      select case when f.user_low = v_uid then f.user_high else f.user_low end as other
    ) pick
    join auth.users u on u.id = pick.other
    where (f.user_low = v_uid or f.user_high = v_uid)
      and not private.blocked_between(v_uid, pick.other)
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.get_friends() from public, anon;
grant execute on function public.get_friends() to authenticated;

-- Recently played (F3.7): distinct accounts from the caller's last five
-- completed tables, newest first, minus bots, guests, self and blocks.
create or replace function public.get_recent_players()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  return coalesce((
    with my_matches as (
      select r.match_id, m.ended_at
      from public.match_results r
      join public.matches m on m.id = r.match_id and m.end_reason = 'completed'
      where r.user_id = v_uid and r.account_kind = 'account'
      order by m.ended_at desc
      limit 5
    ),
    others as (
      select o.user_id, max(mm.ended_at) as last_played
      from my_matches mm
      join public.match_results o on o.match_id = mm.match_id
      where o.account_kind = 'account'
        and o.user_id is not null
        and o.user_id <> v_uid
        and not private.blocked_between(v_uid, o.user_id)
      group by o.user_id
    )
    select jsonb_agg(jsonb_build_object(
      'userId', o.user_id,
      'displayName', coalesce(u.raw_user_meta_data ->> 'display_name', 'Player'),
      'avatarId', u.raw_user_meta_data ->> 'avatar_id',
      'level', coalesce((select level from public.player_progression pr where pr.user_id = o.user_id), 1),
      'isFriend', private.are_friends(v_uid, o.user_id),
      'activeRoom', private.user_active_room(o.user_id)
    ) order by o.last_played desc)
    from others o
    join auth.users u on u.id = o.user_id
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.get_recent_players() from public, anon;
grant execute on function public.get_recent_players() to authenticated;

-- "Add friend" from the recently-played list (F3.7). Bounded to people the
-- caller has actually shared a recent completed table with, so it can't be
-- used to request arbitrary accounts.
create or replace function public.add_recent_player_friend(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not exists (
    select 1
    from public.match_results mine
    join public.match_results theirs on theirs.match_id = mine.match_id
    join public.matches m on m.id = mine.match_id and m.end_reason = 'completed'
    where mine.user_id = v_uid and mine.account_kind = 'account'
      and theirs.user_id = p_user_id and theirs.account_kind = 'account'
  ) then
    raise exception 'NOT_A_RECENT_PLAYER';
  end if;
  return private.request_friend(p_user_id);
end;
$$;
revoke execute on function public.add_recent_player_friend(uuid) from public, anon;
grant execute on function public.add_recent_player_friend(uuid) to authenticated;

-- Playing alongside a friend earns bonus XP (F3.2's friend hook, now that the
-- graph exists). Adds friendBonus to xp_config and applies it in the award.
create or replace function private.xp_config()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'baseFinish', 50,
    'winBonus', 100,
    'dailyFirstWinBonus', 100,
    'computerOnlyFactor', 0.25,
    'repeatStep', 0.2,
    'minRepeatFactor', 0.2,
    'friendFactor', 1.25       -- a friend was at the table
  );
$$;
revoke execute on function private.xp_config() from public;

-- Redefines 20260929070000_cosmetics.sql's version: multiplies in the friend
-- factor when another account at the table is an accepted friend.
create or replace function private.award_match_xp(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := private.xp_config();
  v_rule_credit numeric;
  v_day date;
  r record;
  v_other_humans int;
  v_repeats int;
  v_first_win_today boolean;
  v_daily_bonus int;
  v_human_factor numeric;
  v_repeat_factor numeric;
  v_friend_factor numeric;
  v_with_friend boolean;
  v_xp int;
  v_inserted int;
begin
  select private.ludo_rule_credit(m.rules), m.ended_at::date
  into v_rule_credit, v_day
  from public.matches m
  where m.id = p_match_id and m.end_reason = 'completed';
  if not found then return; end if;

  for r in
    select user_id, player_id, placement
    from public.match_results
    where match_id = p_match_id
      and account_kind = 'account'
      and user_id is not null
      and placement is not null
      and ended_under_takeover = false
  loop
    select count(*) into v_other_humans
    from public.match_results o
    where o.match_id = p_match_id
      and o.player_id <> r.player_id
      and o.account_kind in ('account', 'guest')
      and o.ended_under_takeover = false;
    v_human_factor := case when v_other_humans = 0
      then (v_cfg->>'computerOnlyFactor')::numeric else 1 end;

    select exists (
      select 1 from public.match_results o
      where o.match_id = p_match_id
        and o.player_id <> r.player_id
        and o.account_kind = 'account'
        and o.user_id is not null
        and private.are_friends(r.user_id, o.user_id)
    ) into v_with_friend;
    v_friend_factor := case when v_with_friend then (v_cfg->>'friendFactor')::numeric else 1 end;

    select count(distinct m2.id) into v_repeats
    from public.matches m2
    join public.match_results r2
      on r2.match_id = m2.id and r2.user_id = r.user_id and r2.account_kind = 'account'
    where m2.end_reason = 'completed'
      and m2.id <> p_match_id
      and m2.ended_at::date = v_day
      and exists (
        select 1
        from public.match_results here
        join public.match_results there
          on there.match_id = m2.id and there.user_id = here.user_id
        where here.match_id = p_match_id
          and here.user_id is not null
          and here.user_id <> r.user_id
      );
    v_repeat_factor := greatest(
      (v_cfg->>'minRepeatFactor')::numeric,
      1 - (v_cfg->>'repeatStep')::numeric * v_repeats
    );

    v_first_win_today := false;
    if r.placement = 1 then
      v_first_win_today := not exists (
        select 1
        from public.match_results r3
        join public.matches m3 on m3.id = r3.match_id
        where r3.user_id = r.user_id
          and r3.account_kind = 'account'
          and r3.placement = 1
          and m3.end_reason = 'completed'
          and m3.id <> p_match_id
          and m3.ended_at::date = v_day
      );
    end if;
    v_daily_bonus := case when v_first_win_today
      then (v_cfg->>'dailyFirstWinBonus')::int else 0 end;

    v_xp := round(
      ((v_cfg->>'baseFinish')::numeric
        + case when r.placement = 1 then (v_cfg->>'winBonus')::numeric else 0 end)
      * v_human_factor
      * v_rule_credit
      * v_repeat_factor
      * v_friend_factor
    )::int + v_daily_bonus;

    insert into public.xp_awards (match_id, user_id, xp, breakdown)
    values (p_match_id, r.user_id, v_xp, jsonb_build_object(
      'placement', r.placement,
      'otherHumans', v_other_humans,
      'humanFactor', v_human_factor,
      'ruleCredit', v_rule_credit,
      'repeats', v_repeats,
      'repeatFactor', v_repeat_factor,
      'friendFactor', v_friend_factor,
      'dailyFirstWinBonus', v_daily_bonus
    ))
    on conflict (match_id, user_id) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      insert into public.player_progression (user_id, xp, level)
      values (r.user_id, v_xp, private.xp_level_for(v_xp))
      on conflict (user_id) do update
        set xp = public.player_progression.xp + excluded.xp,
            level = private.xp_level_for(public.player_progression.xp + excluded.xp),
            updated_at = now();

      perform private.touch_streak(r.user_id, v_day);
      perform private.evaluate_achievements(r.user_id);
      perform private.evaluate_cosmetics(r.user_id);
    end if;
  end loop;
end;
$$;
revoke execute on function private.award_match_xp(uuid) from public;
