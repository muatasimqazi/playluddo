-- pgTAP tests for supabase/migrations/20260928130000_party_reconnect.sql: a
-- party table waits for a missing phone on its turn, resumes when it comes
-- back, hands the seat to a computer after two minutes, and a player can
-- hold it up at most 3 times a match. now() is fixed inside this
-- transaction, so time passing is simulated by backdating.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(16);

create temporary table rc_state (key text primary key, value jsonb);
grant select, insert on rc_state to authenticated;

insert into auth.users (id, email, is_anonymous) values
  ('eeeeeeee-0000-0000-0000-000000000001', null, true),
  ('eeeeeeee-0000-0000-0000-000000000002', 'a@rc.test', false),
  ('eeeeeeee-0000-0000-0000-000000000003', 'b@rc.test', false),
  ('eeeeeeee-0000-0000-0000-000000000004', 'host@rc.test', false);

create function pg_temp.room(k text default 'party') returns uuid language sql as $$
  select (value->>'roomId')::uuid from rc_state where key = k;
$$;
create function pg_temp.seat(k text) returns uuid language sql as $$
  select (value->>'playerId')::uuid from rc_state where key = k;
$$;
-- As the table owner: it's `k`'s turn to roll, the turn has run out, and
-- their phone was last seen `secs` ago.
create function pg_temp.turn_expired(k text, secs int, r text default 'party') returns void language sql as $$
  update public.rooms set turn_player_id = pg_temp.seat(k), turn_phase = 'awaiting_roll', active_dice_value = null,
    turn_deadline_at = now() - interval '1 second'
  where id = pg_temp.room(r);
  update public.players set last_seen_at = now() - make_interval(secs => secs) where id = pg_temp.seat(k);
$$;
create function pg_temp.waiting_for() returns uuid language sql as $$
  select paused_for_player_id from public.rooms where id = pg_temp.room();
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000001';
insert into rc_state values ('party', public.create_party_room('ludo'));
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000002';
insert into rc_state select 'a', public.join_room((select value->>'code' from rc_state where key = 'party'), 'Ana');
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000003';
insert into rc_state select 'b', public.join_room((select value->>'code' from rc_state where key = 'party'), 'Ben');
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000002';
select public.start_match(pg_temp.room());
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000004';
insert into rc_state values ('plain', public.create_room('Hosty', null, 2));
insert into rc_state values ('host', jsonb_build_object('playerId', (select host_player_id from public.rooms where id = pg_temp.room('plain'))));
select public.fill_bot(pg_temp.room('plain'), 2);
select public.start_match(pg_temp.room('plain'));
reset role;

-- -------------------------------------------------------------------------
-- Waiting for a phone, and it coming back
-- -------------------------------------------------------------------------

select pg_temp.turn_expired('a', 40);
select public.sweep_expired_turns();
select is(pg_temp.waiting_for(), pg_temp.seat('a'), 'a phone gone on its turn pauses the table for it');
select is(
  (select status from public.players where id = pg_temp.seat('a')), 'connected',
  'and no computer takes the seat'
);
select is(
  private.ludo_room_state_json(pg_temp.room())->>'pausedForPlayerId', pg_temp.seat('a')::text,
  'the screen and phones are told who the table is waiting for'
);

set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000003';
select public.party_heartbeat(pg_temp.room());
reset role;
select is(pg_temp.waiting_for(), pg_temp.seat('a'), 'another phone does not resume it');

set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000002';
select public.party_heartbeat(pg_temp.room());
reset role;
select results_eq(
  $$select paused_at is null, paused_for_player_id is null, turn_deadline_at > now() from public.rooms where id = pg_temp.room()$$,
  $$values (true, true, true)$$,
  'the missing phone coming back resumes the table with a fresh turn'
);
select is(
  (select payload->>'reason' from public.match_events where room_id = pg_temp.room() and event_type = 'match_resumed' order by sequence desc limit 1),
  'reconnected',
  'the resume is recorded'
);

-- A phone that's here but slow times out as usual.
select pg_temp.turn_expired('a', 5);
select public.sweep_expired_turns();
select results_eq(
  $$select (select paused_at is null from public.rooms where id = pg_temp.room()), missed_decision_count from public.players where id = pg_temp.seat('a')$$,
  $$values (true, 1)$$,
  'a phone that is still here just misses the turn'
);

-- -------------------------------------------------------------------------
-- Two minutes: a computer takes over
-- -------------------------------------------------------------------------

select pg_temp.turn_expired('b', 40);
select public.sweep_expired_turns();
select is(pg_temp.waiting_for(), pg_temp.seat('b'), 'the table waits for Ben');
update public.rooms set paused_at = now() - interval '90 seconds' where id = pg_temp.room();
select public.sweep_expired_turns();
select is(pg_temp.waiting_for(), pg_temp.seat('b'), 'it is still waiting after 90 seconds');
update public.rooms set paused_at = now() - interval '121 seconds' where id = pg_temp.room();
select public.sweep_expired_turns();
select results_eq(
  $$select (select paused_at is null from public.rooms where id = pg_temp.room()), status from public.players where id = pg_temp.seat('b')$$,
  $$values (true, 'bot'::text)$$,
  'after two minutes a computer takes the seat and play goes on'
);
select is(
  (select payload->>'reason' from public.match_events where room_id = pg_temp.room() and event_type = 'match_resumed' order by sequence desc limit 1),
  'computer_took_over',
  'the takeover is recorded'
);

-- -------------------------------------------------------------------------
-- The VIP can carry on without them
-- -------------------------------------------------------------------------

update public.players set status = 'connected' where id = pg_temp.seat('b');
select pg_temp.turn_expired('b', 40);
select public.sweep_expired_turns();
set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000002';
select public.toggle_match_pause(pg_temp.room(), false);
reset role;
select results_eq(
  $$select paused_at is null, paused_for_player_id is null, turn_deadline_at > now() from public.rooms where id = pg_temp.room()$$,
  $$values (true, true, true)$$,
  'the VIP resuming ends the wait, with the turn restarted in full'
);

-- -------------------------------------------------------------------------
-- Limits
-- -------------------------------------------------------------------------

-- Ben has held the table up twice; a third time is allowed, a fourth isn't.
select pg_temp.turn_expired('b', 40);
select public.sweep_expired_turns();
select is(pg_temp.waiting_for(), pg_temp.seat('b'), 'a third wait is allowed');
set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-0000-0000-000000000003';
select public.party_heartbeat(pg_temp.room());
reset role;
select pg_temp.turn_expired('b', 50);
select public.sweep_expired_turns();
select results_eq(
  $$select (select paused_at is null from public.rooms where id = pg_temp.room()), status from public.players where id = pg_temp.seat('b')$$,
  $$values (true, 'bot'::text)$$,
  'a fourth absence gets the normal takeover'
);

select pg_temp.turn_expired('host', 50, 'plain');
select public.sweep_expired_turns();
select results_eq(
  $$select paused_at is null, paused_for_player_id is null from public.rooms where id = pg_temp.room('plain')$$,
  $$values (true, true)$$,
  'ordinary rooms never wait'
);
select is(
  (select status from public.players where id = pg_temp.seat('host')), 'bot',
  'they keep the 45-second takeover'
);

select * from finish();
rollback;
