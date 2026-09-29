-- Player profile and stats (docs/COMPETITIVE_ROADMAP.md F3.1, Section 15 R1,
-- R7). One read, get_player_profile, serves two callers:
--   * the signed-in player's own profile (p_player_id null), and
--   * another seat's profile, opened from that seat's avatar at the table
--     (p_player_id = players.id).
--
-- Account ids are never returned to clients (the same stance get_match_results
-- takes): a seat is addressed by players.id, and the account behind it is
-- resolved here. A player can hide their stats from others with the
-- profile_hidden metadata flag (set from the profile panel); their name and
-- avatar stay visible, since those already show at the table, and they always
-- see their own full profile.
--
-- Everything is derived from match_results (F0.3), so it inherits that
-- pipeline's guarantee: only real, completed matches count. Guest and bot
-- seats have no account profile.

-- The signed-in account's display name and avatar, from Auth metadata, the
-- way leaderboard_json (20260922010000_leaderboard.sql) reads them.
create or replace function private.profile_identity(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'displayName', coalesce(u.raw_user_meta_data ->> 'display_name', 'Player'),
    'avatarId', u.raw_user_meta_data ->> 'avatar_id',
    'country', u.raw_user_meta_data ->> 'country'
  )
  from auth.users u
  where u.id = p_user_id;
$$;

revoke execute on function private.profile_identity(uuid) from public;

-- The aggregated stats for one account, over its own completed-match results.
-- Only account_kind = 'account' rows count: a match a player finished as a
-- signed-in account, not a guest session that later signed in.
create or replace function private.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select r.match_id, r.color, r.placement, r.stats, m.game_type
    from public.match_results r
    join public.matches m on m.id = r.match_id and m.end_reason = 'completed'
    where r.user_id = p_user_id
      and r.account_kind = 'account'
      and r.placement is not null
  ),
  by_mode as (
    select game_type,
      count(*) as games,
      count(*) filter (where placement = 1) as wins
    from mine group by game_type
  ),
  -- Head-to-head against everyone met at a table (F3.1 lists it "against
  -- friends"; friends come with F3.6, so for now it ranks by games played
  -- together). A win is finishing ahead of them in a shared match.
  rivals as (
    select o.user_id,
      count(*) as games,
      count(*) filter (where me.placement < o.placement) as wins
    from mine me
    join public.match_results o
      on o.match_id = me.match_id
      and o.user_id is not null
      and o.user_id <> p_user_id
      and o.account_kind = 'account'
      and o.placement is not null
    group by o.user_id
    order by games desc, wins desc
    limit 5
  )
  select jsonb_build_object(
    'gamesPlayed', (select count(*) from mine),
    'wins', (select count(*) filter (where placement = 1) from mine),
    'winRateByMode', coalesce((
      select jsonb_agg(jsonb_build_object('mode', game_type, 'games', games, 'wins', wins)
        order by games desc)
      from by_mode
    ), '[]'::jsonb),
    'totalCaptures', (select coalesce(sum((stats->>'capturesMade')::int), 0) from mine),
    'totalSixes', (select coalesce(sum((stats->>'sixes')::int), 0) from mine),
    'favouriteColour', (select mode() within group (order by color) from mine),
    -- Best comeback (proxy): the win that took the longest dice drought to
    -- pull off -- the most rolls in a row without a six, in a match this
    -- account still went on to win. Null until the account has a win.
    'bestComeback', (
      select coalesce(max((stats->>'longestRunWithoutSix')::int), 0)
      from mine where placement = 1
    ),
    'headToHead', coalesce((
      select jsonb_agg(jsonb_build_object(
        'displayName', coalesce(u.raw_user_meta_data ->> 'display_name', 'Player'),
        'avatarId', u.raw_user_meta_data ->> 'avatar_id',
        'games', rv.games,
        'wins', rv.wins
      ) order by rv.games desc, rv.wins desc)
      from rivals rv
      join auth.users u on u.id = rv.user_id
    ), '[]'::jsonb)
  );
$$;

revoke execute on function private.profile_stats(uuid) from public;

-- p_player_id null -> the caller's own profile (always full, even if hidden).
-- p_player_id set  -> the account behind that seat, respecting profile_hidden.
create or replace function public.get_player_profile(p_player_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_target uuid;
  v_self boolean;
  v_hidden boolean;
  v_identity jsonb;
begin
  if v_caller is null then raise exception 'UNAUTHENTICATED'; end if;

  if p_player_id is null then
    v_target := v_caller;
  else
    -- A bot or unfilled seat has no account behind it.
    select user_id into v_target
    from public.players
    where id = p_player_id and is_bot = false;
    if v_target is null then
      return jsonb_build_object('visibility', 'none');
    end if;
  end if;

  -- Guests (anonymous accounts) have no public profile.
  if exists (select 1 from auth.users where id = v_target and is_anonymous = true) then
    return jsonb_build_object('visibility', 'guest');
  end if;

  v_self := v_target = v_caller;
  v_identity := private.profile_identity(v_target);
  if v_identity is null then
    return jsonb_build_object('visibility', 'none');
  end if;

  v_hidden := coalesce(
    (select raw_user_meta_data ->> 'profile_hidden' from auth.users where id = v_target),
    'false'
  ) = 'true';

  if v_hidden and not v_self then
    return jsonb_build_object('visibility', 'hidden', 'isSelf', false) || v_identity;
  end if;

  return jsonb_build_object('visibility', 'visible', 'isSelf', v_self, 'hidden', v_hidden)
    || v_identity
    || private.profile_stats(v_target);
end;
$$;

revoke execute on function public.get_player_profile(uuid) from public, anon;
grant execute on function public.get_player_profile(uuid) to authenticated;
