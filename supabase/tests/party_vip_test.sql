-- pgTAP tests for supabase/migrations/20260928100000_party_vip.sql: the VIP
-- role passes on only when the VIP has been away for 30 seconds, to the
-- lowest-numbered seat still here, never to a computer, and only in a
-- party room's lobby. now() is fixed inside this transaction, so being away
-- is simulated by backdating last_seen_at.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(9);

create temporary table vip_state (key text primary key, value jsonb);
grant select, insert on vip_state to authenticated;

insert into auth.users (id, email, is_anonymous) values
  ('cccccccc-0000-0000-0000-000000000001', null, true),
  ('cccccccc-0000-0000-0000-000000000002', 'a@vip.test', false),
  ('cccccccc-0000-0000-0000-000000000003', 'b@vip.test', false),
  ('cccccccc-0000-0000-0000-000000000004', 'c@vip.test', false),
  ('cccccccc-0000-0000-0000-000000000005', 'solo@vip.test', false);

create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from vip_state where key = 'party';
$$;
create function pg_temp.seat(k text) returns uuid language sql as $$
  select (value->>'playerId')::uuid from vip_state where key = k;
$$;
create function pg_temp.host() returns uuid language sql as $$
  select host_player_id from public.rooms where id = pg_temp.room();
$$;
-- As the table owner: mark seats as last seen `secs` ago.
create function pg_temp.away(k text, secs int) returns void language sql as $$
  update public.players set last_seen_at = now() - make_interval(secs => secs) where id = pg_temp.seat(k);
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
insert into vip_state values ('party', public.create_party_room('ludo'));
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000002';
insert into vip_state select 'a', public.join_room((select value->>'code' from vip_state where key = 'party'), 'Ana');
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
insert into vip_state select 'b', public.join_room((select value->>'code' from vip_state where key = 'party'), 'Ben');
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000004';
insert into vip_state select 'c', public.join_room((select value->>'code' from vip_state where key = 'party'), 'Cy');
reset role;

select is(pg_temp.host(), pg_temp.seat('a'), 'Ana, first to sit, is the VIP');

-- Ana was seen 20s ago: still here.
select pg_temp.away('a', 20);
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000004';
select public.party_heartbeat(pg_temp.room());
reset role;
select is(pg_temp.host(), pg_temp.seat('a'), 'a VIP seen within 30 seconds keeps the role');

-- Ana gone for 40s; Ben and Cy are here. Cy's heartbeat hands it to Ben,
-- the lowest-numbered seat still here.
select pg_temp.away('a', 40);
select pg_temp.away('b', 5);
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000004';
select public.party_heartbeat(pg_temp.room());
reset role;
select is(pg_temp.host(), pg_temp.seat('b'), 'the role passes to the lowest-numbered seat still here');
select is(
  (select count(*)::int from public.match_events where room_id = pg_temp.room() and event_type = 'vip_changed'),
  1,
  'the handover is recorded'
);

-- Ana and Ben both gone; a computer sits in the last seat. Cy, the only
-- person here, takes it: computers never do.
select pg_temp.away('a', 60);
select pg_temp.away('b', 60);
insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
values (pg_temp.room(), 3, null, 'Bot 4', 'blue', 'bot', true);
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000004';
select public.party_heartbeat(pg_temp.room());
reset role;
select is(pg_temp.host(), pg_temp.seat('c'), 'a computer never becomes the VIP');

-- The screen isn't a seat, so it has no heartbeat.
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
select throws_ok(
  format('select public.party_heartbeat(%L)', pg_temp.room()),
  'P0001', 'SEAT_NOT_CONTROLLED',
  'the screen can''t send a heartbeat'
);

-- Once the game starts, the role no longer moves.
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000004';
select public.start_match(pg_temp.room());
reset role;
select pg_temp.away('c', 60);
update public.players set last_seen_at = now() where id = pg_temp.seat('a');
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000002';
select public.party_heartbeat(pg_temp.room());
reset role;
select is(pg_temp.host(), pg_temp.seat('c'), 'in a running game the VIP doesn''t change');

-- Ordinary rooms: a heartbeat changes nothing.
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000005';
insert into vip_state values ('solo', public.create_room('Solo'));
select lives_ok(
  format('select public.party_heartbeat(%L)', (select value->>'roomId' from vip_state where key = 'solo')),
  'a heartbeat in an ordinary room is harmless'
);
reset role;
select is(
  (select host_player_id from public.rooms where id = (select (value->>'roomId')::uuid from vip_state where key = 'solo')),
  (select (value->>'playerId')::uuid from vip_state where key = 'solo'),
  'and leaves its host alone'
);

select * from finish();
rollback;
