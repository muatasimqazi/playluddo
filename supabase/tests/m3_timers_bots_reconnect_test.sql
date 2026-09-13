-- pgTAP tests for supabase/migrations/20260913225951_m3_timers_bots_reconnect.sql:
-- missed-decision escalation, disconnect-based takeover, bot-turn
-- auto-resolution, the sweep job's outer expired-room selection, duplicate
-- sessions, reclaim, and abandonment. Run with `supabase test db`.
--
-- Dice randomness is sidestepped the same way rpc_flow_test.sql does: board
-- states are engineered so the outcome is deterministic regardless of which
-- die value comes up (e.g., a pawn already on the track at pathIndex 0 has
-- a legal move for any roll 1-6).

begin;
select plan(25);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'p1@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'p2@test.com');

insert into public.rooms (id, code, status, turn_phase) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'M3TEST', 'in_game', 'awaiting_roll');

insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 0,
   '11111111-1111-1111-1111-111111111111', 'P1', 'red', 'connected', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 1,
   '22222222-2222-2222-2222-222222222222', 'P2', 'green', 'connected', false);

update public.rooms set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000001'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', gs, 'nest', null
from generate_series(0, 3) as gs;
insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', gs, 'nest', null
from generate_series(0, 3) as gs;

-- -------------------------------------------------------------------------
-- Missed-decision escalation: 1 -> connected, 2 -> inactive, 3 -> bot.
-- Room state is reset back to P1's turn between calls so each call tests
-- exactly one more consecutive miss, regardless of what perform_roll did.
-- -------------------------------------------------------------------------

select private.ludo_resolve_turn_timeout('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select missed_decision_count from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  1, 'first miss increments missed_decision_count to 1'
);
select is(
  (select status from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'connected', 'status stays connected after a single miss'
);

update public.rooms set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000001', turn_phase = 'awaiting_roll'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select private.ludo_resolve_turn_timeout('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select status from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'inactive', 'second consecutive miss marks the seat inactive'
);

update public.rooms set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000001', turn_phase = 'awaiting_roll'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select private.ludo_resolve_turn_timeout('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select status from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'bot', 'third consecutive miss hands the seat to the bot'
);
select is(
  (select missed_decision_count from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  3, 'missed_decision_count reflects exactly 3 misses'
);

-- -------------------------------------------------------------------------
-- Disconnect-based takeover: staleness alone escalates straight to bot,
-- even on the very first missed decision.
-- -------------------------------------------------------------------------

update public.players set last_seen_at = now() - interval '1 hour'
where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.rooms set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000002', turn_phase = 'awaiting_roll'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select private.ludo_resolve_turn_timeout('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select status from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'bot', 'a stale (45s+) player escalates to bot on their very first miss'
);
select is(
  (select missed_decision_count from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1, 'the miss counter still only reflects one miss even though status jumped straight to bot'
);

-- -------------------------------------------------------------------------
-- Bot-controlled turn auto-resolution: give the seat a guaranteed legal
-- move (a pawn already on the track) and confirm the timeout resolver
-- actually plays it, not just marks the seat.
-- -------------------------------------------------------------------------

update public.pawns set state = 'track', path_index = 0
where player_id = 'bbbbbbbb-0000-0000-0000-000000000002' and pawn_index = 0;
update public.rooms
set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000002', turn_phase = 'awaiting_roll', active_dice_value = null
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select private.ludo_resolve_turn_timeout('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select turn_phase from public.rooms where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'awaiting_move', 'resolving a bot-controlled awaiting_roll turn with a guaranteed legal move lands on awaiting_move'
);
select ok(
  (select active_dice_value from public.rooms where id = 'aaaaaaaa-0000-0000-0000-000000000001') between 1 and 6,
  'a real server-side die value was rolled'
);

select private.ludo_resolve_turn_timeout('aaaaaaaa-0000-0000-0000-000000000001');
select ok(
  exists(
    select 1 from public.match_events
    where room_id = 'aaaaaaaa-0000-0000-0000-000000000001' and event_type = 'legal_move_selected'
  ),
  'resolving a bot-controlled awaiting_move turn actually applies a chosen move'
);

-- -------------------------------------------------------------------------
-- Deadline helper: bot-controlled -> immediate; human -> full 15s window.
-- -------------------------------------------------------------------------

update public.players set status = 'connected', is_bot = false, auto_roll_enabled = false
where id = 'bbbbbbbb-0000-0000-0000-000000000001';

select ok(
  private.ludo_next_turn_deadline('bbbbbbbb-0000-0000-0000-000000000002') <= now() + interval '1 second',
  'a bot-controlled player gets an immediate deadline'
);
select ok(
  private.ludo_next_turn_deadline('bbbbbbbb-0000-0000-0000-000000000001') > now() + interval '10 seconds',
  'a human player gets the full 15s decision window'
);

-- -------------------------------------------------------------------------
-- toggle_auto_roll: resolves immediately when it's already your turn.
-- -------------------------------------------------------------------------

update public.rooms
set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000001', turn_phase = 'awaiting_roll', active_dice_value = null
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select public.toggle_auto_roll('aaaaaaaa-0000-0000-0000-000000000001'::uuid, true);
select is(
  (select auto_roll_enabled from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  true, 'toggle_auto_roll sets the flag'
);
select ok(
  exists(
    select 1 from public.match_events
    where room_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and event_type = 'dice_rolled'
      and player_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  ),
  'enabling auto-roll on your own turn resolves it immediately, not on the next sweep tick'
);

reset role;
update public.players set auto_roll_enabled = false where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- -------------------------------------------------------------------------
-- claim_seat / duplicate sessions: an old token is rejected, the latest
-- claimed token still works.
-- -------------------------------------------------------------------------

update public.rooms
set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000001', turn_phase = 'awaiting_roll', active_dice_value = null
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into test_state (key, value)
select 'token_a', public.claim_seat('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
insert into test_state (key, value)
select 'token_b', public.claim_seat('aaaaaaaa-0000-0000-0000-000000000001'::uuid);

select isnt(
  (select value->>'connectionToken' from test_state where key = 'token_a'),
  (select value->>'connectionToken' from test_state where key = 'token_b'),
  'each claim_seat call issues a fresh token'
);

select throws_ok(
  $$select public.request_roll(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      ((select value->>'connectionToken' from test_state where key = 'token_a'))::uuid
    )$$,
  'P0001', 'SESSION_REPLACED',
  'a tab holding a superseded token is rejected'
);

select lives_ok(
  $$select public.request_roll(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      ((select value->>'connectionToken' from test_state where key = 'token_b'))::uuid
    )$$,
  'the tab holding the latest claimed token can still act'
);

reset role;

-- -------------------------------------------------------------------------
-- reclaim_seat
-- -------------------------------------------------------------------------

update public.players
set status = 'inactive', missed_decision_count = 2
where id = 'bbbbbbbb-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select public.reclaim_seat('aaaaaaaa-0000-0000-0000-000000000001'::uuid);
select results_eq(
  $$select status, missed_decision_count from public.players
    where id = 'bbbbbbbb-0000-0000-0000-000000000001'$$,
  $$values ('connected'::text, 0)$$,
  'reclaim_seat restores connected status and resets the miss counter'
);

select throws_ok(
  $$select public.reclaim_seat('aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'P0001', 'NOTHING_TO_RECLAIM',
  'reclaiming an already-connected seat fails'
);

reset role;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select throws_ok(
  $$select public.reclaim_seat('aaaaaaaa-0000-0000-0000-000000000001'::uuid)$$,
  'P0001', 'NOTHING_TO_RECLAIM',
  'a user with no seat in the room has nothing to reclaim'
);
reset role;

-- -------------------------------------------------------------------------
-- Abandonment
-- -------------------------------------------------------------------------

update public.players set status = 'bot' where room_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select private.ludo_check_abandonment('aaaaaaaa-0000-0000-0000-000000000001');
select ok(
  (select all_absent_since from public.rooms where id = 'aaaaaaaa-0000-0000-0000-000000000001') is not null,
  'starts the all-absent clock once no seated player is connected'
);
select is(
  (select status from public.rooms where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'in_game', 'not yet abandoned before 3 minutes have elapsed'
);

update public.rooms set all_absent_since = now() - interval '4 minutes'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select private.ludo_check_abandonment('aaaaaaaa-0000-0000-0000-000000000001');
select results_eq(
  $$select status, match_end_reason from public.rooms
    where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  $$values ('abandoned'::text, 'abandoned'::text)$$,
  'abandons the match once the all-absent clock exceeds 3 minutes'
);

-- -------------------------------------------------------------------------
-- sweep_expired_turns: only touches in_game rooms whose deadline has
-- passed. Uses two fresh rooms — room 001 above already ended (abandoned)
-- in the previous block, which is itself a fine side-confirmation that
-- sweep's `status = 'in_game'` filter excludes ended rooms, but isn't what
-- this section is testing.
-- -------------------------------------------------------------------------

insert into public.rooms (id, code, status, turn_phase, turn_deadline_at) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'M3TEST2', 'in_game', 'awaiting_roll', now() + interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'M3TEST3', 'in_game', 'awaiting_roll', now() - interval '5 seconds');
insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 0,
   '11111111-1111-1111-1111-111111111111', 'P3', 'red', 'connected', false),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003', 0,
   '22222222-2222-2222-2222-222222222222', 'P4', 'red', 'connected', false);
update public.rooms set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000003'
where id = 'aaaaaaaa-0000-0000-0000-000000000002';
update public.rooms set turn_player_id = 'bbbbbbbb-0000-0000-0000-000000000004'
where id = 'aaaaaaaa-0000-0000-0000-000000000003';

select public.sweep_expired_turns();

select is(
  (select count(*) from public.match_events where room_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0::bigint, 'sweep does not touch an in_game room whose deadline has not passed'
);
select ok(
  exists(
    select 1 from public.match_events
    where room_id = 'aaaaaaaa-0000-0000-0000-000000000003' and event_type = 'dice_rolled'
  ),
  'sweep resolves an in_game room whose deadline has passed'
);

select * from finish();
rollback;
