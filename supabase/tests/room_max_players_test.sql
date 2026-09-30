-- Regression coverage for supabase/migrations/20260920020000_room_max_players.sql:
-- the home page's 2/3/4 player choice must actually be persisted and
-- enforced (create_room, join_room, fill_bot, set_player_color,
-- start_match, set_room_max_players), not just bot-filled to 4 regardless.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(15);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444401', 'host-a@test.com'),
  ('44444444-4444-4444-4444-444444444402', 'guest-a@test.com'),
  ('44444444-4444-4444-4444-444444444403', 'stranger-a@test.com'),
  ('44444444-4444-4444-4444-444444444404', 'host-b@test.com'),
  ('44444444-4444-4444-4444-444444444405', 'guest-b@test.com');

-- -------------------------------------------------------------------------
-- Room A: created for exactly 2 players.
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444401';

insert into test_state (key, value)
values ('roomA', (select public.create_room('HostA', null, 2)));

select is(
  (select max_players from public.rooms where id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid),
  2,
  'create_room persists the chosen max_players instead of defaulting to 4'
);

-- F5.2 widened the range to 2-6 (hex board). 5 and 6 are now accepted; 7 is
-- the first value still rejected.
select lives_ok(
  $$select public.create_room('FivePlayer', null, 5)$$,
  'create_room accepts 5 players (hex board)'
);
select throws_ok(
  $$select public.create_room('Nope', null, 7)$$,
  'P0001',
  'INVALID_PLAYER_COUNT',
  'create_room rejects a player count outside 2-6'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444402';
insert into test_state (key, value)
select 'joinA', public.join_room((select value->>'code' from test_state where key = 'roomA'), 'GuestA');
select results_eq(
  $$select seat_index from public.players
    where id = ((select value->>'playerId' from test_state where key = 'joinA'))::uuid$$,
  $$values (2)$$,
  'the second joiner takes the seat diagonally across from the host (red''s diagonal is yellow, seat 2), not just the next one'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444403';
select throws_ok(
  $$select public.join_room((select value->>'code' from test_state where key = 'roomA'), 'StrangerA')$$,
  'P0001',
  'ROOM_FULL',
  'a third player cannot join a room capped at 2'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444401';
select throws_ok(
  $$select public.fill_bot(((select value->>'roomId' from test_state where key = 'roomA'))::uuid, 1)$$,
  'P0001',
  'INVALID_SEAT',
  'a bot cannot be added to a seat that is not the host''s diagonal (green is not red''s diagonal)'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444402';
select throws_ok(
  $$select public.set_player_color(((select value->>'roomId' from test_state where key = 'roomA'))::uuid, 'green')$$,
  'P0001',
  'INVALID_SEAT',
  'once seated diagonally, a 2-player room locks further color changes to that pairing'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444401';
select public.start_match(((select value->>'roomId' from test_state where key = 'roomA'))::uuid);
select is(
  (select count(*) from public.players where room_id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid),
  2::bigint,
  'start_match does not bot-fill past the room''s own max_players'
);
select is(
  (select count(*) from public.pawns where room_id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid),
  8::bigint,
  'only the 2 seated players are dealt pawns'
);

-- -------------------------------------------------------------------------
-- Room B: default 4-player room, exercising set_room_max_players.
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444404';
insert into test_state (key, value)
values ('roomB', (select public.create_room('HostB')));

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444405';
insert into test_state (key, value)
select 'joinB', public.join_room((select value->>'code' from test_state where key = 'roomB'), 'GuestB');

select throws_ok(
  $$select public.set_room_max_players(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 2)$$,
  'P0001',
  'NOT_HOST',
  'only the host can change the room''s player count'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444404';
select public.fill_bot(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 2);
select throws_ok(
  $$select public.set_room_max_players(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 2)$$,
  'P0001',
  'TOO_MANY_SEATED',
  'the player count cannot be lowered below the number of seated players'
);

-- F5.2: a 2-player room is always the cross, so its seats are the four cross
-- colours (orange/black would switch the board to the hexagon).
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444403';
insert into test_state (key, value)
values ('roomC', (select public.create_room('HostC', null, 2)));
select throws_ok(
  $$select public.set_player_color(((select value->>'roomId' from test_state where key = 'roomC'))::uuid, 'orange')$$,
  'P0001',
  'INVALID_SEAT',
  'a 2-player room has no orange (hex-only) seat'
);
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444404';

-- F5.2: the hexagon is Ludo only; Snakes & Ladders stays 2-4, both ways round.
select lives_ok(
  $$select public.set_room_max_players(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 6)$$,
  'a Ludo room can grow to six seats'
);
select throws_ok(
  $$select public.set_room_game(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 'snakes_and_ladders')$$,
  'P0001',
  'SNAKES_MAX_FOUR_PLAYERS',
  'a six-seat room cannot switch to Snakes & Ladders'
);
select public.set_room_max_players(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 4);
select public.set_room_game(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 'snakes_and_ladders');
select throws_ok(
  $$select public.set_room_max_players(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 5)$$,
  'P0001',
  'SNAKES_MAX_FOUR_PLAYERS',
  'a Snakes & Ladders room cannot grow past four seats'
);

select * from finish();
rollback;
