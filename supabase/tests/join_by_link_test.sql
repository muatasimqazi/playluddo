-- Coverage for supabase/migrations/20260927050000_join_by_link.sql: a friend
-- opening a shared room link sees the invite and can take a seat by room id,
-- under the same rules as joining by code. Run with `supabase test db`.

begin;
select plan(9);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777701', 'link-host@test.com'),
  ('77777777-7777-7777-7777-777777777702', 'link-friend@test.com'),
  ('77777777-7777-7777-7777-777777777703', 'link-late@test.com');

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777701', true);
insert into test_state values ('room', public.create_room('Hosty', null, 2));

-- The friend isn't seated yet: the invite shows who's hosting and that
-- there's room.
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777702', true);
insert into test_state values ('invite', public.room_invite((select (value->>'roomId')::uuid from test_state where key = 'room')));
select is((select value->>'hostName' from test_state where key = 'invite'), 'Hosty', 'invite names the host');
select is((select value->>'status' from test_state where key = 'invite'), 'lobby', 'invite reports the table is open');
select is((select (value->>'isSeated')::boolean from test_state where key = 'invite'), false, 'the friend is not seated yet');

insert into test_state values ('join', public.join_room_by_id((select (value->>'roomId')::uuid from test_state where key = 'room'), '  Fren  '));
reset role;
select results_eq(
  $$select seat_index, display_name from public.players
    where id = (select (value->>'playerId')::uuid from test_state where key = 'join')$$,
  $$values (2, 'Fren'::text)$$,
  'the friend is seated diagonally from the host, name trimmed'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777702', true);
select is(
  public.join_room_by_id((select (value->>'roomId')::uuid from test_state where key = 'room'), 'Fren')->>'playerId',
  (select value->>'playerId' from test_state where key = 'join'),
  'opening the link again keeps the same seat'
);
select is(
  (public.room_invite((select (value->>'roomId')::uuid from test_state where key = 'room'))->>'isSeated')::boolean,
  true, 'the invite now reports the friend as seated'
);

-- A third person on a full 2-player table is turned away.
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777703', true);
select throws_ok(
  format('select public.join_room_by_id(%L, %L)', (select value->>'roomId' from test_state where key = 'room'), 'Late'),
  'P0001', 'ROOM_FULL', 'a full table rejects a late joiner'
);
select throws_ok(
  $$select public.join_room_by_id('00000000-0000-0000-0000-000000000000', 'Late')$$,
  'P0001', 'ROOM_NOT_FOUND', 'an unknown link is reported as not found'
);
select throws_ok(
  $$select public.room_invite('00000000-0000-0000-0000-000000000000')$$,
  'P0001', 'ROOM_NOT_FOUND', 'the invite for an unknown link is not found'
);

select * from finish();
rollback;
