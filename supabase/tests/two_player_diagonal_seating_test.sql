-- Regression coverage for supabase/migrations/20260921020000_two_player_diagonal_seating.sql:
-- a 2-player room should let the host pick any of the 4 bases, then seat
-- the second player (real or bot) diagonally across the board from them
-- (red<->yellow, seats 0<->2; green<->blue, seats 1<->3) — not just at a
-- fixed {0,1}. Run with `supabase test db` (requires `supabase start`).

begin;
select plan(8);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555501', 'diag-host@test.com'),
  ('55555555-5555-5555-5555-555555555502', 'diag-guest@test.com'),
  ('55555555-5555-5555-5555-555555555503', 'diag-host2@test.com');

-- -------------------------------------------------------------------------
-- Room A: the lone host is free to pick any of the 4 bases.
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555501';

insert into test_state (key, value)
values ('roomA', (select public.create_room('DiagHost', null, 2)));

select is(
  (select public.set_player_color(((select value->>'roomId' from test_state where key = 'roomA'))::uuid, 'blue')->>'roomId'),
  (select value->>'roomId' from test_state where key = 'roomA'),
  'a lone host in a 2-player room can pick any of the 4 bases, including one two seats away from red'
);
select is(
  (select seat_index from public.players where id = ((select value->>'playerId' from test_state where key = 'roomA'))::uuid),
  3,
  'the seat follows the freely chosen color (blue = seat 3)'
);

-- -------------------------------------------------------------------------
-- Once a second real player joins, they land on the diagonal (green,
-- seat 1 — blue's diagonal), not a fixed next-available seat.
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555502';
insert into test_state (key, value)
select 'joinA', public.join_room((select value->>'code' from test_state where key = 'roomA'), 'DiagGuest');
select is(
  (select seat_index from public.players where id = ((select value->>'playerId' from test_state where key = 'joinA'))::uuid),
  1,
  'the second joiner is auto-seated at the host''s diagonal (blue''s diagonal is green, seat 1)'
);

select throws_ok(
  $$select public.set_player_color(((select value->>'roomId' from test_state where key = 'roomA'))::uuid, 'red')$$,
  'P0001',
  'INVALID_SEAT',
  'the guest cannot move off the diagonal pairing once both seats are taken'
);

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555501';
select throws_ok(
  $$select public.set_player_color(((select value->>'roomId' from test_state where key = 'roomA'))::uuid, 'yellow')$$,
  'P0001',
  'INVALID_SEAT',
  'the host cannot move off the diagonal pairing once both seats are taken either'
);

-- -------------------------------------------------------------------------
-- Room B: the host picks a base, then a bot fills the diagonal — the
-- same pairing applies whether the second seat is a real player or not.
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555503';
insert into test_state (key, value)
values ('roomB', (select public.create_room('DiagHost2', null, 2)));
select public.set_player_color(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 'yellow');

select throws_ok(
  $$select public.fill_bot(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 1)$$,
  'P0001',
  'INVALID_SEAT',
  'a bot cannot be placed on a seat that is not the seated player''s diagonal'
);
select public.fill_bot(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 0);
select is(
  (select color from public.players where room_id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid and is_bot),
  'red',
  'the bot correctly fills yellow''s diagonal (red, seat 0)'
);

-- start_match must not insert a phantom third bot for a 2-player room
-- whose real seats aren't {0,1} — exactly the bug an unconditional
-- 0..max_players-1 fill loop would hit for a yellow+red (2,0) pairing.
select public.start_match(((select value->>'roomId' from test_state where key = 'roomB'))::uuid);
select is(
  (select count(*) from public.players where room_id = ((select value->>'roomId' from test_state where key = 'roomB'))::uuid),
  2::bigint,
  'start_match does not insert a phantom third bot for a diagonal pair outside seats {0,1}'
);

select * from finish();
rollback;
