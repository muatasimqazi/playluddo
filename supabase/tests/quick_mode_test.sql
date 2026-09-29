-- pgTAP tests for supabase/migrations/20260928190000_quick_mode.sql: a host
-- can set how many pieces start on the board and how many have to get home,
-- the server bounds both, and a match played under them starts and ends
-- accordingly. Classic rooms are untouched.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(15);

create temporary table qm_state (key text primary key, value jsonb);
grant select, insert on qm_state to authenticated;

insert into auth.users (id, is_anonymous)
select ('d1111111-0000-0000-0000-00000000000' || n)::uuid, true from generate_series(1, 3) n;

create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'd1111111-0000-0000-0000-00000000000' || n, true);
$$;
create function pg_temp.room(k text default 'quick') returns uuid language sql as $$
  select (value->>'roomId')::uuid from qm_state where key = k;
$$;
create function pg_temp.on_board(k text default 'quick') returns int language sql as $$
  select count(*)::int from public.pawns where room_id = pg_temp.room(k) and state = 'track';
$$;

-- -------------------------------------------------------------------------
-- The defaults keep the classic game
-- -------------------------------------------------------------------------

select is(
  private.ludo_default_rules(),
  '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4}'::jsonb,
  'the classic game is still the default'
);
select is(
  (private.ludo_resolve_rules('{}'::jsonb)->>'pawnsToWin')::int, 4,
  'a room that says nothing plays the classic game'
);
select is(
  (private.ludo_resolve_rules('{"pawnsToWin": 2}'::jsonb)->>'pawnsToWin')::int, 2,
  'and a room that asks for a shorter game gets one'
);

-- -------------------------------------------------------------------------
-- What a host may ask for
-- -------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user(1);
insert into qm_state values ('quick', public.create_room('Hosty', null, 2));
select pg_temp.as_user(2);
insert into qm_state select 'guest', public.join_room((select value->>'code' from qm_state where key = 'quick'), 'Guest');
select pg_temp.as_user(1);

select lives_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"bonusRollOnFinish": true, "startOnBoard": 1, "pawnsToWin": 2}'),
  'a host sets up a quick game'
);
select throws_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"pawnsToWin": 0}'),
  'P0001', 'INVALID_RULES',
  'a game nobody could win is refused'
);
select throws_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"pawnsToWin": 5}'),
  'P0001', 'INVALID_RULES',
  'and so is one with more pieces than a player has'
);
select throws_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"startOnBoard": 9}'),
  'P0001', 'INVALID_RULES',
  'more pieces cannot start on the board than exist'
);
select throws_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"startOnBoard": true}'),
  'P0001', 'INVALID_RULES',
  'and a count has to be a number'
);
select pg_temp.as_user(2);
select throws_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"pawnsToWin": 2}'),
  'P0001', 'NOT_HOST',
  'only the host chooses'
);

-- -------------------------------------------------------------------------
-- Starting a quick game
-- -------------------------------------------------------------------------

select pg_temp.as_user(1);
select public.start_match(pg_temp.room());
reset role;

select is(pg_temp.on_board(), 2, 'one piece each starts on the board');
select is(
  (select count(distinct path_index)::int from public.pawns where room_id = pg_temp.room() and state = 'track'),
  1,
  'each on its own colour''s entry square'
);
select is(
  (select (match_rules->>'pawnsToWin')::int from public.rooms where id = pg_temp.room()), 2,
  'and the match is frozen with the rules it started under'
);

-- Two pieces home wins it.
select ok(
  private.ludo_is_match_won(
    '[{"color":"red","state":"finished"},{"color":"red","state":"finished"},
      {"color":"red","state":"track"},{"color":"red","state":"nest"}]'::jsonb,
    'red', (select match_rules from public.rooms where id = pg_temp.room())),
  'two pieces home wins a quick game'
);
select ok(
  not private.ludo_is_match_won(
    '[{"color":"red","state":"finished"},{"color":"red","state":"finished"},
      {"color":"red","state":"track"},{"color":"red","state":"nest"}]'::jsonb,
    'red', private.ludo_default_rules()),
  'but not a classic one'
);

-- -------------------------------------------------------------------------
-- Classic rooms are untouched
-- -------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user(3);
insert into qm_state values ('classic', public.create_room('Classic', null, 2));
select public.fill_bot(pg_temp.room('classic'), 2);
select public.start_match(pg_temp.room('classic'));
reset role;
select is(pg_temp.on_board('classic'), 0, 'a classic game still starts with every piece in base');

select * from finish();
rollback;
