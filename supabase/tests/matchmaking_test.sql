-- Coverage for supabase/migrations/20260927020000_matchmaking.sql: quick
-- match seats searchers of the same game and table size together as soon as
-- the table fills, starts after 45s with whoever turned up (computers take
-- the empty seats), ignores players who stopped polling, and lets a player
-- cancel. Run with `supabase test db` (requires `supabase start`). now() is
-- fixed inside this transaction, so waiting is simulated by backdating
-- queue timestamps.

begin;
select plan(27);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email)
select ('66666666-6666-6666-6666-6666666666' || lpad(n::text, 2, '0'))::uuid, 'mm-' || n || '@test.com'
from generate_series(1, 14) n;

create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-6666666666' || lpad(n::text, 2, '0'), true);
$$;
create function pg_temp.room_of(k text) returns uuid language sql as $$
  select (value->>'roomId')::uuid from test_state where key = k;
$$;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- 2 seats: two searchers pair up; a different game never pairs.
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
select is(public.matchmake('ludo', 'Ada', 2)->>'status', 'waiting', 'first 2-seat searcher waits');
select pg_temp.as_user(2);
select is(public.matchmake('snakes_and_ladders', 'Ben', 2)->>'status', 'waiting', 'a different game does not pair');
select pg_temp.as_user(3);
insert into test_state values ('two', public.matchmake('ludo', 'Cy', 2));
select is((select value->>'status' from test_state where key = 'two'), 'matched', 'second 2-seat Ludo searcher is matched');
select is((select (value->>'computers')::int from test_state where key = 'two'), 0, 'against a real player, no computers');
reset role;
select results_eq(
  $$select seat_index, display_name, is_bot from public.players where room_id = pg_temp.room_of('two') order by seat_index$$,
  $$values (0, 'Cy'::text, false), (2, 'Ada'::text, false)$$,
  'the two humans sit diagonally (seats 0 and 2)'
);
select is((select status from public.rooms where id = pg_temp.room_of('two')), 'in_game', 'the table has already started');
set local role authenticated;
select pg_temp.as_user(1);
select is((public.matchmake('ludo', 'Ada', 2)->>'roomId')::uuid, pg_temp.room_of('two'), 'the waiting player''s next poll returns the shared room');

-- ---------------------------------------------------------------------------
-- 4 seats: waits while the table fills, starts the moment it's full.
-- ---------------------------------------------------------------------------
select pg_temp.as_user(4);
select is(public.matchmake('ludo', 'Dee', 4)->>'status', 'waiting', '4-seat searcher waits');
select pg_temp.as_user(5);
select is(public.matchmake('ludo', 'Eve', 2)->>'status', 'waiting', 'a 2-seat Ludo searcher is not pulled into 4 seats (separate queues)');
select pg_temp.as_user(6);
insert into test_state values ('four-wait', public.matchmake('ludo', 'Fay', 4));
select is(
  (select (value->>'found')::int || '/' || (value->>'needed') from test_state where key = 'four-wait'),
  '1/3', 'progress reports opponents found so far'
);
select pg_temp.as_user(7);
select is(public.matchmake('ludo', 'Gus', 4)->>'status', 'waiting', 'three of four seated: still waiting');
select pg_temp.as_user(8);
insert into test_state values ('four', public.matchmake('ludo', 'Hal', 4));
select is((select value->>'status' from test_state where key = 'four'), 'matched', 'the fourth searcher fills the table');
reset role;
select results_eq(
  $$select seat_index, display_name, is_bot from public.players where room_id = pg_temp.room_of('four') order by seat_index$$,
  $$values (0, 'Hal'::text, false), (1, 'Dee'::text, false), (2, 'Fay'::text, false), (3, 'Gus'::text, false)$$,
  'all four humans are seated, no computers'
);
-- Eve asked for 2 seats, so the 4-seat table left her waiting.
select is((select room_id from public.matchmaking_queue where user_id = '66666666-6666-6666-6666-666666666605'), null, 'the 2-seat searcher is untouched');

-- ---------------------------------------------------------------------------
-- 3 seats, timeout: two humans found, a computer takes the last seat.
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(9);
select is(public.matchmake('snakes_and_ladders', 'Ivy', 3)->>'status', 'waiting', '3-seat searcher waits');
select pg_temp.as_user(10);
select is(public.matchmake('snakes_and_ladders', 'Jo', 3)->>'status', 'waiting', 'second of three still waits');
reset role;
update public.matchmaking_queue set enqueued_at = now() - interval '46 seconds'
  where user_id = '66666666-6666-6666-6666-666666666609';
set local role authenticated;
select pg_temp.as_user(9);
insert into test_state values ('three', public.matchmake('snakes_and_ladders', 'Ivy', 3));
select is(
  (select (value->>'players')::int || ' players, ' || (value->>'computers') || ' computer' from test_state where key = 'three'),
  '3 players, 1 computer', 'after 45s the table starts with the humans found plus a computer'
);
reset role;
select results_eq(
  $$select seat_index, is_bot, display_name like 'Bot %' from public.players where room_id = pg_temp.room_of('three') order by seat_index$$,
  $$values (0, false, false), (1, false, false), (2, true, false)$$,
  'humans in seats 0-1, a computer with a friendly name in seat 2'
);
set local role authenticated;
select pg_temp.as_user(10);
select is((public.matchmake('snakes_and_ladders', 'Jo', 3)->>'roomId')::uuid, pg_temp.room_of('three'), 'the other human is sent to the same table');

-- ---------------------------------------------------------------------------
-- 2 seats, alone for 45s: a computer opponent.
-- ---------------------------------------------------------------------------
-- Ben (still waiting for 2-seat Snakes & Ladders since the first section)
-- gives up, so Kit really is alone.
select pg_temp.as_user(2);
select public.cancel_matchmaking();
select pg_temp.as_user(11);
select is(public.matchmake('snakes_and_ladders', 'Kit', 2)->>'status', 'waiting', 'lone searcher waits');
reset role;
update public.matchmaking_queue set enqueued_at = now() - interval '46 seconds'
  where user_id = '66666666-6666-6666-6666-666666666611';
set local role authenticated;
select pg_temp.as_user(11);
select is((public.matchmake('snakes_and_ladders', 'Kit', 2)->>'computers')::int, 1, 'after 45s alone, a computer takes the other seat');

-- ---------------------------------------------------------------------------
-- 4 seats, alone for 45s: three computers (regression: this used to fail
-- with NOT_ENOUGH_PLAYERS because start_match checks seats before bot-fill).
-- ---------------------------------------------------------------------------
select pg_temp.as_user(14);
select is(public.matchmake('ludo', 'Nell', 4)->>'status', 'waiting', 'lone 4-seat searcher waits');
reset role;
update public.matchmaking_queue set enqueued_at = now() - interval '46 seconds'
  where user_id = '66666666-6666-6666-6666-666666666614';
set local role authenticated;
select pg_temp.as_user(14);
select is(
  (select (r->>'players')::int || ' players, ' || (r->>'computers') || ' computers'
   from (select public.matchmake('ludo', 'Nell', 4) as r) m),
  '4 players, 3 computers', 'after 45s alone at a 4-seat table, computers take all three other seats'
);

-- ---------------------------------------------------------------------------
-- A searcher who stopped polling isn't seated; cancel; bad input.
-- ---------------------------------------------------------------------------
select pg_temp.as_user(12);
select is(public.matchmake('ludo', 'Lou', 3)->>'status', 'waiting', 'L waits');
reset role;
update public.matchmaking_queue set last_seen_at = now() - interval '20 seconds'
  where user_id = '66666666-6666-6666-6666-666666666612';
set local role authenticated;
select pg_temp.as_user(13);
select is((public.matchmake('ludo', 'Mo', 3)->>'found')::int, 0, 'a player who stopped polling is not counted or seated');
select is(public.cancel_matchmaking()->>'status', 'cancelled', 'cancelling leaves the queue');

select throws_ok(
  $$select public.matchmake('ludo', 'Mo', 5)$$,
  'P0001', 'INVALID_PLAYER_COUNT', 'table sizes outside 2-4 are rejected'
);

select * from finish();
rollback;
