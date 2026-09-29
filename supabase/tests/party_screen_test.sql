-- pgTAP tests for supabase/migrations/20260928090000_party_screen.sql: the
-- screen can watch its party room and nothing else, the first phone to sit
-- becomes the VIP, and party rooms have no chat or voice. Realtime delivery
-- to the screen is covered by tests/integration/party-screen.test.ts.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(17);

create temporary table party_state (key text primary key, value jsonb);
grant select, insert on party_state to authenticated;

insert into auth.users (id, email, is_anonymous) values
  ('bbbbbbbb-0000-0000-0000-000000000001', null, true),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'phone-a@party.test', false),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'phone-b@party.test', false),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'stranger@party.test', false);

create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from party_state where key = 'party';
$$;
create function pg_temp.code() returns text language sql as $$
  select value->>'code' from party_state where key = 'party';
$$;

-- -------------------------------------------------------------------------
-- The screen creates and watches the room
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
insert into party_state values ('party', public.create_party_room('ludo'));

reset role;
select results_eq(
  $$select is_party, host_player_id is null, status, (select count(*)::int from public.players where room_id = pg_temp.room())
    from public.rooms where id = pg_temp.room()$$,
  $$values (true, true, 'lobby'::text, 0)$$,
  'a party room starts with no host and no seats'
);
select is(
  (select count(*)::int from public.room_displays
   where room_id = pg_temp.room() and user_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  1,
  'the creator is registered as the room''s screen'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';

select is(
  (public.get_party_screen(pg_temp.room())->>'isParty')::boolean,
  true,
  'the screen can read its room''s state'
);
select ok(private.ludo_is_display_of_room(pg_temp.room()), 'the realtime policy recognises the screen');

select throws_ok(
  format('select public.join_room(%L, %L)', pg_temp.code(), 'Sneaky screen'),
  'P0001', 'DISPLAY_CANNOT_SIT',
  'the screen cannot take a seat'
);
select throws_ok(
  format('select public.send_table_message(%L, %L, %L)', pg_temp.room(), 'hi', 'chat'),
  'P0001', 'SEAT_NOT_CONTROLLED',
  'the screen cannot chat'
);
select throws_ok(
  format('select public.request_roll(%L)', pg_temp.room()),
  'P0001', null,
  'the screen cannot roll'
);

set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000004';
select throws_ok(
  format('select public.get_party_screen(%L)', pg_temp.room()),
  'P0001', 'ROOM_NOT_FOUND',
  'only the room''s own screen can read it this way'
);

-- -------------------------------------------------------------------------
-- Phones join; the first becomes the VIP
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into party_state select 'phoneA', public.join_room(pg_temp.code(), 'Ana');
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000003';
insert into party_state select 'phoneB', public.join_room(pg_temp.code(), 'Ben');

reset role;
select is(
  (select host_player_id from public.rooms where id = pg_temp.room()),
  (select (value->>'playerId')::uuid from party_state where key = 'phoneA'),
  'the first phone to sit down becomes the VIP'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000003';
select throws_ok(
  format('select public.start_match(%L)', pg_temp.room()),
  'P0001', 'NOT_HOST',
  'a later phone is not the VIP'
);

-- No chat and no voice in party rooms.
select throws_ok(
  format('select public.send_table_message(%L, %L, %L)', pg_temp.room(), 'hello', 'chat'),
  'P0001', 'PARTY_ROOM',
  'party rooms have no chat'
);
select throws_ok(
  format('select public.join_voice(%L)', pg_temp.room()),
  'P0001', 'PARTY_ROOM',
  'party rooms have no voice'
);
select throws_ok(
  format('select public.send_webrtc_signal(%L, %L, %L)', pg_temp.room(),
         (select value->>'playerId' from party_state where key = 'phoneA'), '{"type": "offer"}'),
  'P0001', 'PARTY_ROOM',
  'party rooms have no call signalling'
);

set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select lives_ok(format('select public.start_match(%L)', pg_temp.room()), 'the VIP starts the game');

reset role;
select results_eq(
  $$select status, (select count(*)::int from public.players where room_id = pg_temp.room() and is_bot)
    from public.rooms where id = pg_temp.room()$$,
  $$values ('in_game'::text, 2)$$,
  'computers fill the empty seats, as in any room'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
select is(
  public.get_party_screen(pg_temp.room())->>'status',
  'in_game',
  'the screen follows the game'
);

-- -------------------------------------------------------------------------
-- Ordinary rooms are unchanged
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000004';
insert into party_state values ('normal', public.create_room('Solo'));
reset role;
select results_eq(
  $$select is_party, host_player_id = (select (value->>'playerId')::uuid from party_state where key = 'normal')
    from public.rooms where id = (select (value->>'roomId')::uuid from party_state where key = 'normal')$$,
  $$values (false, true)$$,
  'an ordinary room still starts with its creator as host'
);

select * from finish();
rollback;
