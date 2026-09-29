-- pgTAP tests for supabase/migrations/20260928120000_party_tv.sql: the
-- party screen reads its own room's event log (and no other), and only the
-- phone whose move it is can preview a legal piece on the screen.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(10);

create temporary table tv_state (key text primary key, value jsonb);
grant select, insert on tv_state to authenticated;

insert into auth.users (id, email, is_anonymous) values
  ('dddddddd-0000-0000-0000-000000000001', null, true),
  ('dddddddd-0000-0000-0000-000000000002', 'a@tv.test', false),
  ('dddddddd-0000-0000-0000-000000000003', 'b@tv.test', false),
  ('dddddddd-0000-0000-0000-000000000004', 'host@tv.test', false);

create function pg_temp.room(k text default 'party') returns uuid language sql as $$
  select (value->>'roomId')::uuid from tv_state where key = k;
$$;
create function pg_temp.seat(k text) returns uuid language sql as $$
  select (value->>'playerId')::uuid from tv_state where key = k;
$$;
create function pg_temp.pawn_of(k text) returns uuid language sql as $$
  select id from public.pawns where player_id = pg_temp.seat(k) order by pawn_index limit 1;
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000001';
insert into tv_state values ('party', public.create_party_room('ludo'));
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000002';
insert into tv_state select 'a', public.join_room((select value->>'code' from tv_state where key = 'party'), 'Ana');
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000003';
insert into tv_state select 'b', public.join_room((select value->>'code' from tv_state where key = 'party'), 'Ben');
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000002';
select public.start_match(pg_temp.room());
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000004';
insert into tv_state values ('plain', public.create_room('Hosty', null, 2));

-- -------------------------------------------------------------------------
-- The event log
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000001';
select ok(
  (select count(*) from public.match_events where room_id = pg_temp.room()) > 0,
  'the screen reads its room''s events'
);
select is(
  (select count(*)::int from public.match_events where room_id = pg_temp.room('plain')),
  0,
  'the screen reads no other room''s events'
);

-- -------------------------------------------------------------------------
-- Move previews
-- -------------------------------------------------------------------------

select throws_ok(
  format('select public.party_preview_move(%L, %L)', pg_temp.room(), null),
  'P0001', 'SEAT_NOT_CONTROLLED',
  'the screen cannot preview a move'
);

-- Ana's turn, before the roll.
reset role;
update public.rooms set turn_player_id = pg_temp.seat('a'), turn_phase = 'awaiting_roll', active_dice_value = null
where id = pg_temp.room();
set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000002';
select throws_ok(
  format('select public.party_preview_move(%L, %L)', pg_temp.room(), pg_temp.pawn_of('a')),
  'P0001', 'NOT_YOUR_TURN',
  'nothing to preview before the roll'
);

-- Ana rolled a six: every piece in base can come out.
reset role;
update public.rooms set turn_phase = 'awaiting_move', active_dice_value = 6 where id = pg_temp.room();
set local role authenticated;
select lives_ok(
  format('select public.party_preview_move(%L, %L)', pg_temp.room(), pg_temp.pawn_of('a')),
  'the player whose move it is previews a legal piece'
);
select lives_ok(
  format('select public.party_preview_move(%L, %L)', pg_temp.room(), null),
  'and can clear the preview'
);
select throws_ok(
  format('select public.party_preview_move(%L, %L)', pg_temp.room(), pg_temp.pawn_of('b')),
  'P0001', 'ILLEGAL_MOVE',
  'another player''s piece cannot be previewed'
);

set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000003';
select throws_ok(
  format('select public.party_preview_move(%L, %L)', pg_temp.room(), pg_temp.pawn_of('b')),
  'P0001', 'NOT_YOUR_TURN',
  'only the player whose move it is can preview'
);

set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000004';
select throws_ok(
  format('select public.party_preview_move(%L, %L)', pg_temp.room('plain'), null),
  'P0001', 'NOT_PARTY_ROOM',
  'previews are only for party rooms'
);

reset role;
select is(
  (select count(*)::int from public.match_events where room_id = pg_temp.room() and event_type ilike '%preview%'),
  0,
  'previews leave nothing in the event log'
);

select * from finish();
rollback;
