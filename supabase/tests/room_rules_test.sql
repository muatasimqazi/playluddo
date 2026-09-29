-- pgTAP tests for supabase/migrations/20260928040000_room_rules.sql: the
-- host's room rules, freezing them at match start, and the first rule, an
-- extra roll when a pawn gets home (on by default).
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(14);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666601', 'host-a@rules.test'),
  ('66666666-6666-6666-6666-666666666602', 'guest-a@rules.test'),
  ('66666666-6666-6666-6666-666666666603', 'host-b@rules.test'),
  ('66666666-6666-6666-6666-666666666604', 'guest-b@rules.test');

-- Room A keeps the default rules; room B's host turns the extra roll off.
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666601';
insert into test_state (key, value) values ('roomA', (select public.create_room('HostA', null, 2)));
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666602';
insert into test_state (key, value)
select 'joinA', public.join_room((select value->>'code' from test_state where key = 'roomA'), 'GuestA');

set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666603';
insert into test_state (key, value) values ('roomB', (select public.create_room('HostB', null, 2)));
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666604';
insert into test_state (key, value)
select 'joinB', public.join_room((select value->>'code' from test_state where key = 'roomB'), 'GuestB');

-- -------------------------------------------------------------------------
-- Setting rules
-- -------------------------------------------------------------------------

reset role;
select is(
  private.ludo_room_state_json(((select value->>'roomId' from test_state where key = 'roomA'))::uuid)->'rules',
  '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4}'::jsonb,
  'a new room shows the default rules, with the extra roll for getting home on'
);
set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666604';

select throws_ok(
  $$select public.set_room_rules(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, '{"bonusRollOnFinish": false}')$$,
  'P0001',
  'NOT_HOST',
  'only the host can change the rules'
);

set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666603';

select throws_ok(
  $$select public.set_room_rules(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, '{"blockades": true}')$$,
  'P0001',
  'INVALID_RULES',
  'unknown rule keys are rejected'
);

select throws_ok(
  $$select public.set_room_rules(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, '{"bonusRollOnFinish": "no"}')$$,
  'P0001',
  'INVALID_RULES',
  'a rule with the wrong type is rejected'
);

select throws_ok(
  $$select public.set_room_rules(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, '[]')$$,
  'P0001',
  'INVALID_RULES',
  'rules must be an object'
);

select is(
  public.set_room_rules(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, '{"bonusRollOnFinish": false}')->'rules',
  '{"bonusRollOnFinish": false, "startOnBoard": 0, "pawnsToWin": 4}'::jsonb,
  'the host can turn the extra roll for getting home off'
);

reset role;
select is(
  (select count(*)::int from public.match_events
   where room_id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid
     and event_type = 'rules_changed'),
  1,
  'changing the rules is recorded as an event'
);

-- -------------------------------------------------------------------------
-- Freezing at match start
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666601';
select public.start_match(((select value->>'roomId' from test_state where key = 'roomA'))::uuid);
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666603';
select public.start_match(((select value->>'roomId' from test_state where key = 'roomB'))::uuid);

select throws_ok(
  $$select public.set_room_rules(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, '{"bonusRollOnFinish": true}')$$,
  'P0001',
  'ALREADY_STARTED',
  'rules cannot change once the match has started'
);

reset role;

select results_eq(
  $$select match_rules from public.rooms
    where id in (((select value->>'roomId' from test_state where key = 'roomA'))::uuid,
                 ((select value->>'roomId' from test_state where key = 'roomB'))::uuid)
    order by (id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid) desc$$,
  $$values ('{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4}'::jsonb),
           ('{"bonusRollOnFinish": false, "startOnBoard": 0, "pawnsToWin": 4}'::jsonb)$$,
  'start_match freezes each room''s resolved rules for the match'
);

select is(
  (select payload->'rules' from public.match_events
   where room_id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid
     and event_type = 'match_started'),
  '{"bonusRollOnFinish": false, "startOnBoard": 0, "pawnsToWin": 4}'::jsonb,
  'the match_started event records the rules played'
);

-- -------------------------------------------------------------------------
-- The extra roll for getting home. Each host has one pawn three cells from
-- home and a 3 waiting to be moved; their other pawns are still in the nest,
-- so this is not their last pawn.
-- -------------------------------------------------------------------------

update public.pawns set state = 'home_lane', path_index = 53
where pawn_index = 0 and player_id in (
  (select value->>'playerId' from test_state where key = 'roomA')::uuid,
  (select value->>'playerId' from test_state where key = 'roomB')::uuid
);

update public.rooms r
set active_dice_value = 3, turn_phase = 'awaiting_move', turn_player_id = r.host_player_id
where r.id in (((select value->>'roomId' from test_state where key = 'roomA'))::uuid,
               ((select value->>'roomId' from test_state where key = 'roomB'))::uuid);

set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666601';
select public.request_move(
  ((select value->>'roomId' from test_state where key = 'roomA'))::uuid,
  (select id from public.pawns where pawn_index = 0
     and player_id = (select value->>'playerId' from test_state where key = 'roomA')::uuid)
);
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666603';
select public.request_move(
  ((select value->>'roomId' from test_state where key = 'roomB'))::uuid,
  (select id from public.pawns where pawn_index = 0
     and player_id = (select value->>'playerId' from test_state where key = 'roomB')::uuid)
);
reset role;

select results_eq(
  $$select turn_player_id, turn_phase from public.rooms
    where id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid$$,
  $$values ((select value->>'playerId' from test_state where key = 'roomA')::uuid, 'awaiting_roll'::text)$$,
  'getting a pawn home with a 3 earns another roll under the default rules'
);

select is(
  (select state from public.pawns where pawn_index = 0
     and player_id = (select value->>'playerId' from test_state where key = 'roomA')::uuid),
  'finished',
  'the pawn is home'
);

select results_eq(
  $$select turn_player_id, turn_phase from public.rooms
    where id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid$$,
  $$values ((select value->>'playerId' from test_state where key = 'joinB')::uuid, 'awaiting_roll'::text)$$,
  'with the rule off, getting a pawn home with a 3 passes the turn'
);

select is(
  (select status from public.rooms where id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid),
  'in_game',
  'getting a pawn home that is not the last one does not end the match'
);

select * from finish();
rollback;
