-- pgTAP tests for supabase/migrations/20260930150000_cast_to_tv.sql: a seated
-- player casts their table to a TV, which gets read-only access through a
-- private topic (ordinary rooms) or as a display (party rooms). Links expire.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(20);

create temporary table cast_state (key text primary key, value jsonb);
grant select, insert on cast_state to authenticated;

insert into auth.users (id, email, is_anonymous) values
  ('cccccccc-0000-0000-0000-000000000001', 'host@cast.test', false),
  ('cccccccc-0000-0000-0000-000000000002', null, true),
  ('cccccccc-0000-0000-0000-000000000003', 'stranger@cast.test', false),
  ('cccccccc-0000-0000-0000-000000000004', null, true),
  ('cccccccc-0000-0000-0000-000000000005', 'phone@cast.test', false),
  ('cccccccc-0000-0000-0000-000000000006', null, true);

create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from cast_state where key = 'room';
$$;
create function pg_temp.token() returns text language sql as $$
  select value->>'token' from cast_state where key = 'link';
$$;
create function pg_temp.party() returns uuid language sql as $$
  select (value->>'roomId')::uuid from cast_state where key = 'party';
$$;

-- -------------------------------------------------------------------------
-- An ordinary room: only a seat can make a link
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
insert into cast_state values ('room', public.create_room('Host'));
insert into cast_state values ('link', public.create_cast_link(pg_temp.room()));

select ok(length(pg_temp.token()) >= 40, 'a seated player gets a long random token');
select is(
  public.create_cast_link(pg_temp.room())->>'token',
  pg_temp.token(),
  'asking again reuses the seat''s live token'
);

set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select throws_ok(
  format('select public.create_cast_link(%L)', pg_temp.room()),
  'P0001', 'SEAT_NOT_CONTROLLED',
  'someone without a seat cannot make a cast link'
);
select throws_ok(
  format('select public.get_cast_state(%L)', pg_temp.room()),
  'P0001', 'ROOM_NOT_FOUND',
  'nor read the room as a TV'
);

-- -------------------------------------------------------------------------
-- The TV claims it
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000002';
select throws_ok(
  format('select public.claim_cast(%L, %L)', pg_temp.room(), 'not-the-token'),
  'P0001', 'CAST_LINK_INVALID',
  'a wrong token is refused'
);
insert into cast_state values ('claim', public.claim_cast(pg_temp.room(), pg_temp.token()));
select is(
  (select value->>'isParty' from cast_state where key = 'claim'),
  'false',
  'an ordinary room is cast through a private topic'
);
select ok(
  (select value->>'castTopic' from cast_state where key = 'claim') like 'cast:%',
  'the TV is told its own topic'
);
select lives_ok(
  format('select public.claim_cast(%L, %L)', pg_temp.room(), pg_temp.token()),
  'claiming again (a reload) is harmless'
);
select is(
  (public.get_cast_state(pg_temp.room())->>'roomId')::uuid,
  pg_temp.room(),
  'the TV can read the room''s state'
);
select ok(
  private.cast_topic_allowed((select value->>'castTopic' from cast_state where key = 'claim')),
  'the realtime policy lets the TV hear its own topic'
);
select ok(
  not private.cast_topic_allowed('room:' || pg_temp.room()::text),
  'but not the room topic, which carries chat and call signalling'
);
select throws_ok(
  format('select public.send_table_message(%L, %L, %L)', pg_temp.room(), 'hi', 'chat'),
  'P0001', 'SEAT_NOT_CONTROLLED',
  'the TV cannot chat'
);
select throws_ok(
  format('select public.request_roll(%L)', pg_temp.room()),
  'P0001', null,
  'the TV cannot roll'
);

-- Another session can't hear that TV's topic.
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000003';
select ok(
  not private.cast_topic_allowed((select value->>'castTopic' from cast_state where key = 'claim')),
  'a stranger cannot hear the TV''s topic'
);

-- -------------------------------------------------------------------------
-- An expired link no longer works
-- -------------------------------------------------------------------------

reset role;
update public.room_cast_links set expires_at = now() - interval '1 minute' where token = pg_temp.token();
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000004';
select throws_ok(
  format('select public.claim_cast(%L, %L)', pg_temp.room(), pg_temp.token()),
  'P0001', 'CAST_LINK_INVALID',
  'an expired link is refused'
);
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
select isnt(
  public.create_cast_link(pg_temp.room())->>'token',
  pg_temp.token(),
  'the seat gets a fresh token once the old one has expired'
);

-- -------------------------------------------------------------------------
-- A party room: the TV becomes one of the room's screens
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000004';
insert into cast_state values ('party', public.create_party_room('ludo'));
set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000005';
select public.join_room_by_id(pg_temp.party(), 'Phone');
insert into cast_state values ('party_link', public.create_cast_link(pg_temp.party()));

set local request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000006';
select is(
  public.claim_cast(pg_temp.party(), (select value->>'token' from cast_state where key = 'party_link'))->>'isParty',
  'true',
  'a party room is cast as a display'
);
select ok(private.ludo_is_display_of_room(pg_temp.party()), 'the TV is now one of the room''s screens');
select is(
  (public.get_party_screen(pg_temp.party())->>'isParty')::boolean,
  true,
  'and reads it the way the Party screen does'
);
select throws_ok(
  format('select public.join_room_by_id(%L, %L)', pg_temp.party(), 'Sneaky TV'),
  'P0001', 'DISPLAY_CANNOT_SIT',
  'the TV cannot take a seat'
);

select * from finish();
rollback;
