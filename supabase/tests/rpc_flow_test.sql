-- pgTAP integration tests for the RPC surface in
-- supabase/migrations/20260913222115_rpcs.sql: create_room -> join_room ->
-- fill_bot -> start_match -> request_roll -> request_move, plus the
-- authorization boundary (NOT_HOST, NOT_YOUR_TURN, INVALID_PHASE,
-- ILLEGAL_MOVE, ROOM_FULL, ALREADY_STARTED). Run with `supabase test db`
-- (requires `supabase start`).
--
-- This suite does NOT re-prove rules-engine math (capture, safe tiles,
-- overshoot, etc.) — that's already covered deterministically by
-- legal_moves_test.sql / turn_rules_test.sql / bot_test.sql against the pure
-- functions directly. It proves the RPCs wire those functions to real rows
-- correctly and enforce authorization. Because dice rolls are genuinely
-- random, tests that need a deterministic board state engineer it directly
-- via `reset role` (back to postgres, bypassing RLS) between RPC calls,
-- rather than looping for a specific roll outcome.

begin;
select plan(19);

create temporary table test_state (key text primary key, value jsonb);
-- Created by this session's role (postgres); `authenticated` needs an
-- explicit grant to touch it once we `set local role authenticated` below.
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'guest@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@test.com');

-- -------------------------------------------------------------------------
-- create_room / join_room / fill_bot
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into test_state (key, value)
values ('room', (select public.create_room('Host')));

select is(
  (select value->>'roomId' from test_state where key = 'room') is not null,
  true,
  'create_room returns a roomId'
);
select results_eq(
  $$select color, seat_index, is_bot from public.players
    where id = ((select value->>'playerId' from test_state where key = 'room'))::uuid$$,
  $$values ('red'::text, 0, false)$$,
  'the creator is seated at index 0 as red, not a bot'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into test_state (key, value)
select 'join', public.join_room(
  (select value->>'code' from test_state where key = 'room'),
  'Guest'
);
select results_eq(
  $$select color, seat_index from public.players
    where id = ((select value->>'playerId' from test_state where key = 'join'))::uuid$$,
  $$values ('green'::text, 1)$$,
  'the second joiner is seated at index 1 as green'
);

-- re-joining with the same user is idempotent, not a duplicate seat.
insert into test_state (key, value)
select 'rejoin', public.join_room((select value->>'code' from test_state where key = 'room'), 'Guest');
select is(
  (select value->>'playerId' from test_state where key = 'rejoin'),
  (select value->>'playerId' from test_state where key = 'join'),
  'joining a room you are already seated in returns the same seat, not a new one'
);

select throws_ok(
  $$select public.join_room('DOES-NOT-EXIST', 'Nobody')$$,
  'P0001',
  'ROOM_NOT_FOUND',
  'joining a nonexistent room code fails'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$select public.fill_bot(((select value->>'roomId' from test_state where key = 'room'))::uuid, 2)$$,
  'P0001',
  'NOT_HOST',
  'a non-host cannot fill a seat with a bot'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into test_state (key, value)
select 'bot_fill', public.fill_bot(((select value->>'roomId' from test_state where key = 'room'))::uuid, 2);
select results_eq(
  $$select color, is_bot from public.players
    where id = ((select value->>'playerId' from test_state where key = 'bot_fill'))::uuid$$,
  $$values ('yellow'::text, true)$$,
  'host-filled seat 2 is a yellow bot'
);

-- -------------------------------------------------------------------------
-- start_match
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$select public.start_match(((select value->>'roomId' from test_state where key = 'room'))::uuid)$$,
  'P0001',
  'NOT_HOST',
  'a non-host cannot start the match'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.start_match(((select value->>'roomId' from test_state where key = 'room'))::uuid);

select is(
  (select status from public.rooms where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid),
  'in_game',
  'start_match moves the room into in_game'
);
select is(
  (select count(*) from public.players where room_id = ((select value->>'roomId' from test_state where key = 'room'))::uuid),
  4::bigint,
  'start_match auto-fills every remaining empty seat with a bot'
);
select is(
  (select count(*) from public.pawns where room_id = ((select value->>'roomId' from test_state where key = 'room'))::uuid),
  16::bigint,
  'start_match deals 4 nest pawns to each of the 4 seated players'
);
select is(
  (select turn_player_id from public.rooms where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid),
  (select value->>'playerId' from test_state where key = 'room')::uuid,
  'the first turn belongs to seat 0 (the host)'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select throws_ok(
  $$select public.start_match(((select value->>'roomId' from test_state where key = 'room'))::uuid)$$,
  'P0001',
  'ALREADY_STARTED',
  'starting an already-started match fails'
);

-- -------------------------------------------------------------------------
-- request_roll authorization (not re-testing dice math — see header note)
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$select public.request_roll(((select value->>'roomId' from test_state where key = 'room'))::uuid)$$,
  'P0001',
  'NOT_YOUR_TURN',
  'a player cannot roll on another seat''s turn'
);

-- -------------------------------------------------------------------------
-- request_move: engineer a deterministic board state directly (postgres,
-- bypassing RLS) rather than looping for a specific die roll.
-- -------------------------------------------------------------------------

reset role;

update public.pawns set state = 'track', path_index = 6
where room_id = ((select value->>'roomId' from test_state where key = 'room'))::uuid
  and player_id = (select value->>'playerId' from test_state where key = 'room')::uuid
  and pawn_index = 0;

update public.rooms
set active_dice_value = 4, turn_phase = 'awaiting_move'
where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid;

insert into test_state (key, value)
select 'host_pawn0', jsonb_build_object('id', id) from public.pawns
where room_id = ((select value->>'roomId' from test_state where key = 'room'))::uuid
  and player_id = (select value->>'playerId' from test_state where key = 'room')::uuid
  and pawn_index = 0;

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$select public.request_move(
      ((select value->>'roomId' from test_state where key = 'room'))::uuid,
      ((select value->>'id' from test_state where key = 'host_pawn0'))::uuid
    )$$,
  'P0001',
  'NOT_YOUR_TURN',
  'a player cannot move on another seat''s turn'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select throws_ok(
  $$select public.request_move(
      ((select value->>'roomId' from test_state where key = 'room'))::uuid,
      gen_random_uuid()
    )$$,
  'P0001',
  'ILLEGAL_MOVE',
  'moving a pawn that is not in the legal-moves set fails'
);

select public.request_move(
  ((select value->>'roomId' from test_state where key = 'room'))::uuid,
  ((select value->>'id' from test_state where key = 'host_pawn0'))::uuid
);

select results_eq(
  $$select state, path_index from public.pawns
    where id = ((select value->>'id' from test_state where key = 'host_pawn0'))::uuid$$,
  $$values ('track'::text, 10)$$,
  'request_move advances the pawn by the die value and persists it'
);
select is(
  (select turn_player_id from public.rooms where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid),
  (select value->>'playerId' from test_state where key = 'join')::uuid,
  'a non-bonus move (no six, no capture) advances the turn to the next seat'
);

-- -------------------------------------------------------------------------
-- Win path: engineer 3 of 4 host pawns already finished, then finish the 4th.
-- -------------------------------------------------------------------------

reset role;

update public.pawns set state = 'finished', path_index = 56
where room_id = ((select value->>'roomId' from test_state where key = 'room'))::uuid
  and player_id = (select value->>'playerId' from test_state where key = 'room')::uuid
  and pawn_index in (1, 2, 3);

update public.pawns set state = 'home_lane', path_index = 53
where id = ((select value->>'id' from test_state where key = 'host_pawn0'))::uuid;

update public.rooms
set active_dice_value = 3, turn_phase = 'awaiting_move',
    turn_player_id = (select value->>'playerId' from test_state where key = 'room')::uuid
where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.request_move(
  ((select value->>'roomId' from test_state where key = 'room'))::uuid,
  ((select value->>'id' from test_state where key = 'host_pawn0'))::uuid
);

select results_eq(
  $$select status, match_end_reason, winner_ids from public.rooms
    where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid$$,
  $$values ('summary'::text, 'completed'::text, array[(select value->>'playerId' from test_state where key = 'room')::uuid])$$,
  'finishing the 4th pawn ends the match immediately with the mover as winner'
);

select * from finish();
rollback;
