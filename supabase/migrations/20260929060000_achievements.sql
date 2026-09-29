-- Achievements on every platform (docs/COMPETITIVE_ROADMAP.md F3.4, Section
-- 15 R1, R8, R10).
--
-- A catalog of achievements evaluated on the server from match_results, so
-- the same unlocks show on web, Android and iOS. Evaluation rides on the F3.2
-- XP ledger: an insert trigger on xp_awards re-checks the account's lifetime
-- record once per eligible completed match, so it inherits that pipeline's
-- idempotency and offline games never unlock anything.
--
-- gc_id maps an achievement to its Game Center id, for the iOS mirror. Only a
-- few have one today; the rest are web/Android until they're created in App
-- Store Connect. Per decision 17, only online results are ever mirrored.

create table public.achievements (
  id text primary key,
  name text not null,
  description text not null,
  sort int not null,
  gc_id text
);

alter table public.achievements enable row level security;
grant select on public.achievements to authenticated, anon;

create table public.player_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create index player_achievements_user_id_idx on public.player_achievements(user_id);
alter table public.player_achievements enable row level security;
revoke all on public.player_achievements from anon, authenticated;

insert into public.achievements (id, name, description, sort, gc_id) values
  ('first_win',   'First Victory',  'Win an online game.',                              10, 'com.luddohouse.first_win'),
  ('ludo_win',    'Ludo Champion',  'Win a game of Ludo.',                              20, 'com.luddohouse.ludo_win'),
  ('snakes_win',  'Snake Charmer',  'Win a game of Snakes & Ladders.',                  30, 'com.luddohouse.snakes_win'),
  ('both_games',  'All-Rounder',    'Win at both Ludo and Snakes & Ladders.',           40, null),
  ('wins_10',     'Ten Up',         'Win 10 games.',                                    50, 'com.luddohouse.ten_wins'),
  ('wins_50',     'Half Century',   'Win 50 games.',                                    60, null),
  ('games_10',    'Regular',        'Play 10 games.',                                   70, null),
  ('games_50',    'Devoted',        'Play 50 games.',                                   80, null),
  ('games_100',   'Marathon',       'Play 100 games.',                                  90, null),
  ('full_house',  'Full House',     'Win a four-player game.',                         100, null),
  ('flawless',    'Untouchable',    'Win a game of Ludo without losing a pawn.',       110, null),
  ('survivor',    'Survivor',       'Win a game of Ludo after losing three pawns.',    120, null),
  ('finisher',    'Clean Sweep',    'Get all four pawns home in one game.',            130, null),
  ('triple',      'Triple Threat',  'Capture three pawns in a single game.',           140, null),
  ('sharp',       'Sharpshooter',   'Capture five pawns in a single game.',            150, null),
  ('comeback',    'Never Say Die',  'Win after ten rolls in a row without a six.',     160, null),
  ('captures_100','Menace',         'Capture 100 pawns in all.',                       170, null),
  ('sixes_100',   'Hot Dice',       'Roll 100 sixes in all.',                          180, null),
  ('level_5',     'Rising',         'Reach level 5.',                                  190, null),
  ('level_10',    'Seasoned',       'Reach level 10.',                                 200, null),
  ('level_25',    'Veteran',        'Reach level 25.',                                 210, null),
  ('streak_3',    'Warmed Up',      'Play three days in a row.',                       220, null),
  ('streak_7',    'Week Strong',    'Play seven days in a row.',                       230, null),
  ('streak_30',   'Unstoppable',    'Play thirty days in a row.',                      240, null);

-- Re-evaluates an account's lifetime record and unlocks anything newly earned.
-- Idempotent: unlocks insert on conflict do nothing. Runs per finished match
-- (see the trigger below), but conditions are lifetime, so it also catches
-- achievements that don't depend on the latest match.
create or replace function private.evaluate_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  v_level int := coalesce((select level from public.player_progression where user_id = p_user_id), 1);
  v_streak int := coalesce((select longest_streak from public.player_streaks where user_id = p_user_id), 0);
begin
  with mine as (
    select r.placement, r.stats, m.game_type,
      (select count(*) from public.match_results rc where rc.match_id = r.match_id) as seats
    from public.match_results r
    join public.matches m on m.id = r.match_id and m.end_reason = 'completed'
    where r.user_id = p_user_id and r.account_kind = 'account' and r.placement is not null
  )
  select
    count(*) as games,
    count(*) filter (where placement = 1) as wins,
    count(*) filter (where placement = 1 and game_type = 'ludo') as ludo_wins,
    count(*) filter (where placement = 1 and game_type = 'snakes_and_ladders') as snakes_wins,
    coalesce(sum((stats->>'capturesMade')::int), 0) as captures,
    coalesce(sum((stats->>'sixes')::int), 0) as sixes,
    coalesce(max((stats->>'capturesMade')::int), 0) as max_caps,
    coalesce(bool_or(placement = 1 and game_type = 'ludo'
      and coalesce((stats->>'pawnsLost')::int, 0) = 0), false) as flawless,
    coalesce(bool_or(placement = 1 and game_type = 'ludo'
      and coalesce((stats->>'pawnsLost')::int, 0) >= 3), false) as survivor,
    coalesce(bool_or(coalesce((stats->>'pawnsFinished')::int, 0) >= 4), false) as finisher,
    coalesce(bool_or(placement = 1 and seats >= 4), false) as full_house,
    coalesce(bool_or(placement = 1
      and coalesce((stats->>'longestRunWithoutSix')::int, 0) >= 10), false) as comeback
  into a
  from mine;

  insert into public.player_achievements (user_id, achievement_id)
  select p_user_id, cand.id
  from (values
    ('first_win',    a.wins >= 1),
    ('ludo_win',     a.ludo_wins >= 1),
    ('snakes_win',   a.snakes_wins >= 1),
    ('both_games',   a.ludo_wins >= 1 and a.snakes_wins >= 1),
    ('wins_10',      a.wins >= 10),
    ('wins_50',      a.wins >= 50),
    ('games_10',     a.games >= 10),
    ('games_50',     a.games >= 50),
    ('games_100',    a.games >= 100),
    ('full_house',   a.full_house),
    ('flawless',     a.flawless),
    ('survivor',     a.survivor),
    ('finisher',     a.finisher),
    ('triple',       a.max_caps >= 3),
    ('sharp',        a.max_caps >= 5),
    ('comeback',     a.comeback),
    ('captures_100', a.captures >= 100),
    ('sixes_100',    a.sixes >= 100),
    ('level_5',      v_level >= 5),
    ('level_10',     v_level >= 10),
    ('level_25',     v_level >= 25),
    ('streak_3',     v_streak >= 3),
    ('streak_7',     v_streak >= 7),
    ('streak_30',    v_streak >= 30)
  ) cand(id, met)
  where cand.met
  on conflict (user_id, achievement_id) do nothing;
end;
$$;

revoke execute on function private.evaluate_achievements(uuid) from public;

create or replace function private.achievements_on_award()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.evaluate_achievements(new.user_id);
  return new;
end;
$$;

revoke execute on function private.achievements_on_award() from public;

create trigger achievements_on_award
after insert on public.xp_awards
for each row
execute function private.achievements_on_award();

-- Redefines 20260929050000_daily_streak.sql's version: adds the account's
-- achievements (every catalog entry, with an unlocked flag) to the profile.
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
    ), '[]'::jsonb),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ac.id,
        'name', ac.name,
        'description', ac.description,
        'unlocked', pa.user_id is not null,
        'unlockedAt', pa.unlocked_at
      ) order by ac.sort)
      from public.achievements ac
      left join public.player_achievements pa
        on pa.achievement_id = ac.id and pa.user_id = p_user_id
    ), '[]'::jsonb)
  );
$$;

revoke execute on function private.profile_stats(uuid) from public;

-- The Game Center ids of the achievements an account has unlocked, for the
-- iOS mirror (decision 17: online results only, which all match_results are).
create or replace function public.get_game_center_unlocks()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(a.gc_id), '[]'::jsonb)
  from public.player_achievements pa
  join public.achievements a on a.id = pa.achievement_id
  where pa.user_id = (select auth.uid()) and a.gc_id is not null;
$$;

revoke execute on function public.get_game_center_unlocks() from public, anon;
grant execute on function public.get_game_center_unlocks() to authenticated;
