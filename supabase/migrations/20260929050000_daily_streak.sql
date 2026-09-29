-- Daily streak (docs/COMPETITIVE_ROADMAP.md F3.3, Section 15 R1, R8, R10).
--
-- A streak counts days on which the account finished at least one eligible
-- online match. It rides on the XP ledger: F3.2 writes exactly one xp_awards
-- row per eligible completed match per account, so an insert trigger there
-- advances the streak once per match — idempotent for free, and offline games
-- (which never reach match_results) can't touch it.
--
-- A missed day breaks the streak unless the player has an earned streak
-- freeze to spend. Freezes are earned at milestones (3, 7, 30 days), never
-- sold, and there is no spin wheel. The milestones reached are recorded so
-- F3.5 can grant the milestone cosmetics once that catalog exists.
--
-- Days are counted in UTC (the match's ended_at date); R10 can revisit this.

create table public.player_streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_played_date date,
  -- Earned days-off that cover a gap so the streak survives.
  freezes int not null default 0,
  -- Milestone day counts already rewarded, so a freeze is granted once each.
  milestones_reached int[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.player_streaks enable row level security;
revoke all on public.player_streaks from anon, authenticated;

-- Records that an account played on p_play_date, moving its streak forward,
-- spending freezes to bridge a gap, and granting a freeze the first time it
-- reaches each milestone.
create or replace function private.touch_streak(p_user_id uuid, p_play_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.player_streaks;
  v_missed int;
  v_next int;
  v_freezes int;
  v_reached int[];
  m int;
begin
  select * into v from public.player_streaks where user_id = p_user_id for update;

  if not found then
    v_next := 1;
    v_freezes := 0;
    v_reached := '{}';
  elsif v.last_played_date = p_play_date then
    return; -- already counted today
  elsif v.last_played_date is not null and v.last_played_date > p_play_date then
    return; -- a match finalized out of order; never rewrite history backwards
  else
    v_missed := coalesce((p_play_date - v.last_played_date) - 1, 0);
    v_freezes := v.freezes;
    v_reached := v.milestones_reached;
    if v_missed <= 0 then
      v_next := v.current_streak + 1; -- the very next day
    elsif v_freezes >= v_missed then
      v_next := v.current_streak + 1; -- bridge the gap with freezes
      v_freezes := v_freezes - v_missed;
    else
      v_next := 1; -- streak broken
    end if;
  end if;

  -- Grant a freeze the first time each milestone is reached.
  foreach m in array array[3, 7, 30] loop
    if v_next >= m and not (m = any(v_reached)) then
      v_reached := v_reached || m;
      v_freezes := v_freezes + 1;
    end if;
  end loop;

  insert into public.player_streaks
    (user_id, current_streak, longest_streak, last_played_date, freezes, milestones_reached, updated_at)
  values (p_user_id, v_next, greatest(v_next, coalesce(v.longest_streak, 0)), p_play_date,
          v_freezes, v_reached, now())
  on conflict (user_id) do update set
    current_streak = excluded.current_streak,
    longest_streak = excluded.longest_streak,
    last_played_date = excluded.last_played_date,
    freezes = excluded.freezes,
    milestones_reached = excluded.milestones_reached,
    updated_at = now();
end;
$$;

revoke execute on function private.touch_streak(uuid, date) from public;

-- Fires once per (match, user), because xp_awards has that primary key and is
-- inserted on conflict do nothing (F3.2). Uses the match's day.
create or replace function private.streak_on_award()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date;
begin
  select ended_at::date into v_day from public.matches where id = new.match_id;
  if v_day is not null then
    perform private.touch_streak(new.user_id, v_day);
  end if;
  return new;
end;
$$;

revoke execute on function private.streak_on_award() from public;

create trigger streak_on_award
after insert on public.xp_awards
for each row
execute function private.streak_on_award();

-- Redefines 20260929040000_xp_and_levels.sql's version: adds the account's
-- streak to the profile payload (F3.3).
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
    'xp', coalesce((select xp from public.player_progression where user_id = p_user_id), 0),
    'level', coalesce((select level from public.player_progression where user_id = p_user_id), 1),
    'currentStreak', coalesce((select current_streak from public.player_streaks where user_id = p_user_id), 0),
    'longestStreak', coalesce((select longest_streak from public.player_streaks where user_id = p_user_id), 0),
    'streakFreezes', coalesce((select freezes from public.player_streaks where user_id = p_user_id), 0),
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
