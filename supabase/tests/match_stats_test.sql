-- pgTAP tests for supabase/migrations/20260928050000_match_stats.sql:
-- match identity, stats derived from a known sequence of events, results
-- recorded once however a match ends, and who can read them.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(17);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777701', 'host-a@stats.test'),
  ('77777777-7777-7777-7777-777777777702', 'guest-a@stats.test'),
  ('77777777-7777-7777-7777-777777777703', 'host-b@stats.test'),
  ('77777777-7777-7777-7777-777777777704', 'guest-b@stats.test'),
  ('77777777-7777-7777-7777-777777777705', 'host-d@stats.test'),
  ('77777777-7777-7777-7777-777777777706', 'guest-d@stats.test'),
  ('77777777-7777-7777-7777-777777777707', 'stranger@stats.test');

-- Three 2-player rooms: A is played through a known sequence of events, B
-- times out and is abandoned, D stands in for a match already running when
-- the migration deployed.
set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777701';
insert into test_state (key, value) values ('roomA', (select public.create_room('HostA', null, 2)));
-- A lobby event before the match starts.
select public.set_room_rules(((select value->>'roomId' from test_state where key = 'roomA'))::uuid, '{"bonusRollOnFinish": false}');
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777702';
insert into test_state (key, value)
select 'joinA', public.join_room((select value->>'code' from test_state where key = 'roomA'), 'GuestA');
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777701';
select public.start_match(((select value->>'roomId' from test_state where key = 'roomA'))::uuid);

set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777703';
insert into test_state (key, value) values ('roomB', (select public.create_room('HostB', null, 2)));
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777704';
insert into test_state (key, value)
select 'joinB', public.join_room((select value->>'code' from test_state where key = 'roomB'), 'GuestB');
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777703';
select public.start_match(((select value->>'roomId' from test_state where key = 'roomB'))::uuid);

set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777705';
insert into test_state (key, value) values ('roomD', (select public.create_room('HostD', null, 2)));
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777706';
insert into test_state (key, value)
select 'joinD', public.join_room((select value->>'code' from test_state where key = 'roomD'), 'GuestD');
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777705';
select public.start_match(((select value->>'roomId' from test_state where key = 'roomD'))::uuid);

reset role;

insert into test_state (key, value)
select 'ids', jsonb_build_object(
  'roomA', r.id,
  'matchA', r.current_match_id,
  'hostA', (select value->>'playerId' from test_state where key = 'roomA'),
  'guestA', (select value->>'playerId' from test_state where key = 'joinA'),
  'guestA_pawn0', (select id from public.pawns
                   where player_id = (select value->>'playerId' from test_state where key = 'joinA')::uuid
                     and pawn_index = 0)
)
from public.rooms r where r.id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid;

-- -------------------------------------------------------------------------
-- Match identity
-- -------------------------------------------------------------------------

select results_eq(
  $$select room_id, game_type, rules, ended_at is null from public.matches
    where id = ((select value->>'matchA' from test_state where key = 'ids'))::uuid$$,
  $$values (((select value->>'roomA' from test_state where key = 'ids'))::uuid, 'ludo'::text,
            '{"bonusRollOnFinish": false, "startOnBoard": 0, "pawnsToWin": 4}'::jsonb, true)$$,
  'start_match creates an open match with the room''s frozen rules'
);

select is(
  (select match_id from public.match_events
   where room_id = ((select value->>'roomA' from test_state where key = 'ids'))::uuid
     and event_type = 'match_started'),
  ((select value->>'matchA' from test_state where key = 'ids'))::uuid,
  'the match_started event carries the match id'
);

select is(
  (select array[jsonb_array_length(payload->'seats'), jsonb_array_length(payload->'pawns')]
   from public.match_events
   where room_id = ((select value->>'roomA' from test_state where key = 'ids'))::uuid
     and event_type = 'match_started'),
  array[2, 8],
  'the match_started snapshot records every seat and pawn'
);

select is(
  (select match_id from public.match_events
   where room_id = ((select value->>'roomA' from test_state where key = 'ids'))::uuid
     and event_type = 'rules_changed'),
  null,
  'lobby events before the match carry no match id'
);

-- -------------------------------------------------------------------------
-- Stats from a known sequence. Host rolls 6, 6, 3 (one turn), guest rolls
-- 2, host rolls 4, guest misses a decision, then rolls 6, 1 (one turn).
-- The host captures a guest pawn and gets a pawn home; the guest makes a
-- plain move.
-- -------------------------------------------------------------------------

create function pg_temp.roll(p_player text, p_die int) returns void language sql as $$
  select null::void from (select private.ludo_append_event(
    ((select value->>'roomA' from test_state where key = 'ids'))::uuid, 'dice_rolled',
    ((select value->>p_player from test_state where key = 'ids'))::uuid,
    jsonb_build_object('dieValue', p_die, 'cancelledByThirdSix', false))) s;
$$;

create function pg_temp.move(p_player text, p_captures jsonb, p_finishes boolean) returns void language sql as $$
  select null::void from (select private.ludo_append_event(
    ((select value->>'roomA' from test_state where key = 'ids'))::uuid, 'legal_move_selected',
    ((select value->>p_player from test_state where key = 'ids'))::uuid,
    jsonb_build_object('pawnId', 'x', 'fromTileId', 'track:1', 'toTileId', 'track:2',
                       'capturesPawnIds', p_captures, 'finishesPawn', p_finishes))) s;
$$;

select pg_temp.roll('hostA', 6);
select pg_temp.move('hostA', jsonb_build_array((select value->>'guestA_pawn0' from test_state where key = 'ids')), false);
select pg_temp.roll('hostA', 6);
select pg_temp.roll('hostA', 3);
select pg_temp.move('hostA', '[]', true);
select pg_temp.roll('guestA', 2);
select pg_temp.roll('hostA', 4);
select private.ludo_append_event(
  ((select value->>'roomA' from test_state where key = 'ids'))::uuid, 'decision_timed_out',
  ((select value->>'guestA' from test_state where key = 'ids'))::uuid,
  '{"phase": "awaiting_roll", "missedDecisions": 1}');
select pg_temp.roll('guestA', 6);
select pg_temp.roll('guestA', 1);
select pg_temp.move('guestA', '[]', false);

insert into test_state (key, value)
select 'expectedA', jsonb_build_object(
  (select value->>'hostA' from test_state where key = 'ids'), jsonb_build_object(
    'rolls', 4, 'sixes', 2, 'faces', '[0, 0, 1, 1, 0, 2]'::jsonb, 'turns', 2,
    'capturesMade', 1, 'pawnsLost', 0, 'pawnsFinished', 1, 'missedDecisions', 0,
    'longestRunWithoutSix', 2),
  (select value->>'guestA' from test_state where key = 'ids'), jsonb_build_object(
    'rolls', 3, 'sixes', 1, 'faces', '[1, 1, 0, 0, 0, 1]'::jsonb, 'turns', 2,
    'capturesMade', 0, 'pawnsLost', 1, 'pawnsFinished', 0, 'missedDecisions', 1,
    'longestRunWithoutSix', 1)
);

select is(
  private.match_stats(((select value->>'matchA' from test_state where key = 'ids'))::uuid),
  (select value from test_state where key = 'expectedA'),
  'stats are derived exactly from the match''s events'
);

-- -------------------------------------------------------------------------
-- Finishing records results once
-- -------------------------------------------------------------------------

update public.rooms
set status = 'summary', match_end_reason = 'completed', turn_phase = 'complete',
    winner_ids = array[((select value->>'hostA' from test_state where key = 'ids'))::uuid]
where id = ((select value->>'roomA' from test_state where key = 'ids'))::uuid;

select results_eq(
  $$select ended_at is not null, end_reason from public.matches
    where id = ((select value->>'matchA' from test_state where key = 'ids'))::uuid$$,
  $$values (true, 'completed'::text)$$,
  'the match is closed when it ends'
);

select results_eq(
  $$select player_id, placement, account_kind, ended_under_takeover from public.match_results
    where match_id = ((select value->>'matchA' from test_state where key = 'ids'))::uuid
    order by placement$$,
  $$values (((select value->>'hostA' from test_state where key = 'ids'))::uuid, 1, 'account'::text, false),
           (((select value->>'guestA' from test_state where key = 'ids'))::uuid, 2, 'account'::text, false)$$,
  'each seat gets a result: the winner first, the unfinished player second'
);

select is(
  (select stats from public.match_results
   where match_id = ((select value->>'matchA' from test_state where key = 'ids'))::uuid
     and player_id = ((select value->>'guestA' from test_state where key = 'ids'))::uuid),
  (select value->(select value->>'guestA' from test_state where key = 'ids') from test_state where key = 'expectedA'),
  'results store the derived stats'
);

insert into test_state (key, value)
select 'endedA', to_jsonb(ended_at) from public.matches
where id = ((select value->>'matchA' from test_state where key = 'ids'))::uuid;

-- End it a second time: nothing is duplicated or overwritten.
update public.rooms set match_end_reason = null where id = ((select value->>'roomA' from test_state where key = 'ids'))::uuid;
update public.rooms set match_end_reason = 'completed' where id = ((select value->>'roomA' from test_state where key = 'ids'))::uuid;

select is(
  (select array[count(*)::text, (select to_jsonb(ended_at)::text from public.matches
                                 where id = ((select value->>'matchA' from test_state where key = 'ids'))::uuid)]
   from public.match_results where match_id = ((select value->>'matchA' from test_state where key = 'ids'))::uuid),
  array['2', (select value::text from test_state where key = 'endedA')],
  'recording a match''s end twice changes nothing'
);

-- -------------------------------------------------------------------------
-- Timeouts and abandonment (room B)
-- -------------------------------------------------------------------------

select private.ludo_resolve_turn_timeout(((select value->>'roomId' from test_state where key = 'roomB'))::uuid);

select is(
  (select match_id from public.match_events
   where room_id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid
     and event_type = 'decision_timed_out'
     and player_id = (select value->>'playerId' from test_state where key = 'roomB')::uuid),
  (select current_match_id from public.rooms where id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid),
  'a missed decision is recorded as an event of the match'
);

update public.rooms set status = 'abandoned', match_end_reason = 'abandoned', turn_phase = 'complete'
where id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid;

select is(
  (select count(*)::int from public.match_results r
   join public.rooms rm on rm.current_match_id = r.match_id
   where rm.id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid
     and r.placement is null),
  2,
  'an abandoned match records results with no placements'
);

select is(
  (select (r.stats->>'missedDecisions')::int from public.match_results r
   join public.rooms rm on rm.current_match_id = r.match_id
   where rm.id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid
     and r.player_id = (select value->>'playerId' from test_state where key = 'roomB')::uuid),
  1,
  'the missed decision is counted in the stats'
);

-- -------------------------------------------------------------------------
-- A match already running before the migration (room D) gets no results
-- -------------------------------------------------------------------------

update public.rooms set current_match_id = null
where id = ((select value->>'roomId' from test_state where key = 'roomD'))::uuid;
update public.rooms
set status = 'summary', match_end_reason = 'completed', turn_phase = 'complete',
    winner_ids = array[(select value->>'playerId' from test_state where key = 'roomD')::uuid]
where id = ((select value->>'roomId' from test_state where key = 'roomD'))::uuid;

select is(
  (select count(*)::int from public.match_results r
   join public.matches m on m.id = r.match_id
   where m.room_id = ((select value->>'roomId' from test_state where key = 'roomD'))::uuid),
  0,
  'a match with no recorded identity gets no guessed results'
);

-- -------------------------------------------------------------------------
-- Who can read results
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777702';

select throws_ok(
  $$select * from public.match_results$$,
  '42501',
  null,
  'players cannot read match_results directly'
);

select throws_ok(
  $$select * from public.matches$$,
  '42501',
  null,
  'players cannot read matches directly'
);

select is(
  (select array[jsonb_array_length(r), (select count(*)::int from jsonb_array_elements(r) e where e ? 'userId')]
   from public.get_match_results(((select value->>'roomId' from test_state where key = 'roomA'))::uuid) r),
  array[2, 0],
  'a player at the table gets every seat''s result, without account ids'
);

set local request.jwt.claim.sub = '77777777-7777-7777-7777-777777777707';
select throws_ok(
  $$select public.get_match_results(((select value->>'roomId' from test_state where key = 'roomA'))::uuid)$$,
  'P0001',
  'ROOM_NOT_FOUND',
  'someone not at the table cannot read its results'
);

select * from finish();
rollback;
