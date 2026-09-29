-- pgTAP tests for supabase/migrations/20260928160000_party_mixed_rooms.sql:
-- a party seat says whether it's in the living room or joining from
-- elsewhere, only players joining from elsewhere get voice and call
-- signalling, and only they follow the ordinary takeover rules.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(22);

create temporary table mx_state (key text primary key, value jsonb);
grant select, insert on mx_state to authenticated;

insert into auth.users (id, is_anonymous)
select ('b8888888-0000-0000-0000-00000000000' || n)::uuid, true from generate_series(1, 5) n;

create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'b8888888-0000-0000-0000-00000000000' || n, true);
$$;
create function pg_temp.room(k text default 'party') returns uuid language sql as $$
  select (value->>'roomId')::uuid from mx_state where key = k;
$$;
create function pg_temp.seat(k text) returns uuid language sql as $$
  select (value->>'playerId')::uuid from mx_state where key = k;
$$;
create function pg_temp.remote(k text) returns boolean language sql as $$
  select party_remote from public.players where id = pg_temp.seat(k);
$$;

set local role authenticated;
select pg_temp.as_user(1);
insert into mx_state values ('party', public.create_party_room('ludo'));
-- Ana is in the living room; Ben and Cy join from elsewhere.
select pg_temp.as_user(2);
insert into mx_state select 'ana', public.join_room_by_id(pg_temp.room(), 'Ana');
select pg_temp.as_user(3);
insert into mx_state select 'ben', public.join_room_by_id(pg_temp.room(), 'Ben');
select pg_temp.as_user(4);
insert into mx_state select 'cy', public.join_room_by_id(pg_temp.room(), 'Cy');

-- -------------------------------------------------------------------------
-- Saying where you are
-- -------------------------------------------------------------------------

select ok(not pg_temp.remote('ana'), 'a party seat is in the living room by default');
select pg_temp.as_user(3);
select lives_ok(
  format('select public.set_party_remote(%L, true)', pg_temp.room()),
  'a player says they are joining from elsewhere'
);
select ok(pg_temp.remote('ben'), 'and the seat records it');
select is(
  (select p->>'partyRemote' from jsonb_array_elements(public.get_room_state(pg_temp.room())->'players') p
   where p->>'id' = pg_temp.seat('ben')::text),
  'true',
  'the screen and phones are told where each player is'
);
select pg_temp.as_user(4);
select lives_ok(format('select public.set_party_remote(%L, true)', pg_temp.room()), 'Cy joins from elsewhere too');

select pg_temp.as_user(5);
select throws_ok(
  format('select public.set_party_remote(%L, true)', pg_temp.room()),
  'P0001', 'SEAT_NOT_CONTROLLED',
  'only the seat''s own holder says where it is'
);
select pg_temp.as_user(1);
select throws_ok(
  format('select public.set_party_remote(%L, true)', pg_temp.room()),
  'P0001', 'SEAT_NOT_CONTROLLED',
  'the screen has no seat to place'
);

-- -------------------------------------------------------------------------
-- Voice
-- -------------------------------------------------------------------------

select pg_temp.as_user(3);
select lives_ok(format('select public.join_voice(%L)', pg_temp.room()), 'a player from elsewhere can use voice');
select pg_temp.as_user(2);
select throws_ok(
  format('select public.join_voice(%L)', pg_temp.room()),
  'P0001', 'PARTY_ROOM',
  'a living-room phone still cannot: everyone there can already hear each other'
);

-- Both ends must be elsewhere for call signalling.
select pg_temp.as_user(3);
select lives_ok(
  format('select public.send_webrtc_signal(%L, %L, %L)', pg_temp.room(), pg_temp.seat('cy'), '{"type":"offer"}'),
  'two players from elsewhere can set up a call'
);
select throws_ok(
  format('select public.send_webrtc_signal(%L, %L, %L)', pg_temp.room(), pg_temp.seat('ana'), '{"type":"offer"}'),
  'P0001', 'PARTY_ROOM',
  'but never to a living-room phone'
);
select pg_temp.as_user(2);
select throws_ok(
  format('select public.send_webrtc_signal(%L, %L, %L)', pg_temp.room(), pg_temp.seat('ben'), '{"type":"offer"}'),
  'P0001', 'PARTY_ROOM',
  'nor from one'
);

-- Call signals go to the recipient's own topic, which only they can read:
-- the living room's screen is on the room topic and must never see them.
select pg_temp.as_user(3);
select ok(
  private.ludo_controls_player(pg_temp.seat('ben')),
  'a player can read their own call topic'
);
select ok(
  not private.ludo_controls_player(pg_temp.seat('cy')),
  'and nobody else''s'
);
select pg_temp.as_user(1);
select ok(
  not private.ludo_controls_player(pg_temp.seat('ben')),
  'the screen cannot read a player''s call topic'
);
select is(
  private.ludo_player_id_from_topic('room:' || pg_temp.room()::text),
  null,
  'the room topic is not a call topic'
);

-- Coming back to the living room ends that seat's call.
select pg_temp.as_user(3);
select pg_temp.as_user(3);
select lives_ok(format('select public.set_party_remote(%L, false)', pg_temp.room()), 'Ben joins the others at the TV');
select ok(
  not (select in_voice from public.players where id = pg_temp.seat('ben')),
  'and leaves the call as he does'
);
select pg_temp.as_user(3);
select lives_ok(format('select public.set_party_remote(%L, true)', pg_temp.room()), 'Ben goes back to playing from elsewhere');

-- -------------------------------------------------------------------------
-- Where you are decides how a quiet phone is handled
-- -------------------------------------------------------------------------

select pg_temp.as_user(2);
select public.start_match(pg_temp.room());
reset role;

-- Ana's living-room phone has gone quiet on her turn: the table waits.
update public.rooms set turn_player_id = pg_temp.seat('ana'), turn_phase = 'awaiting_roll',
  active_dice_value = null, turn_deadline_at = now() - interval '1 second' where id = pg_temp.room();
update public.players set last_seen_at = now() - interval '40 seconds' where id = pg_temp.seat('ana');
select public.sweep_expired_turns();
select is(
  (select paused_for_player_id from public.rooms where id = pg_temp.room()), pg_temp.seat('ana'),
  'a quiet living-room phone still pauses the table for up to two minutes'
);

-- Ben is playing from elsewhere: no waiting, the ordinary rules apply.
update public.rooms set paused_at = null, paused_for_player_id = null,
  turn_player_id = pg_temp.seat('ben'), turn_phase = 'awaiting_roll', active_dice_value = null,
  turn_deadline_at = now() - interval '1 second' where id = pg_temp.room();
update public.players set last_seen_at = now() - interval '50 seconds' where id = pg_temp.seat('ben');
select public.sweep_expired_turns();
select results_eq(
  $$select (select paused_for_player_id is null from public.rooms where id = pg_temp.room()), status
    from public.players where id = pg_temp.seat('ben')$$,
  $$values (true, 'bot'::text)$$,
  'a player from elsewhere gets the ordinary takeover instead'
);

-- Where you sit is settled before the game starts.
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok(
  format('select public.set_party_remote(%L, false)', pg_temp.room()),
  'P0001', 'INVALID_PHASE',
  'nobody moves seats mid-game'
);

select * from finish();
rollback;
