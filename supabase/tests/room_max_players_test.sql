-- Regression coverage for supabase/migrations/20260920020000_room_max_players.sql:
-- the home page's 2/3/4 player choice must actually be persisted and
-- enforced (create_room, join_room, fill_bot, set_player_color,
-- start_match, set_room_max_players), not just bot-filled to 4 regardless.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(10);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444401', 'host-a@test.com'),
  ('44444444-4444-4444-4444-444444444402', 'guest-a@test.com'),
  ('44444444-4444-4444-4444-444444444403', 'stranger-a@test.com'),
  ('44444444-4444-4444-4444-444444444404', 'host-b@test.com'),
  ('44444444-4444-4444-4444-444444444405', 'guest-b@test.com');

-- -------------------------------------------------------------------------
-- Room A: created for exactly 2 players.
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444401';

insert into test_state (key, value)
values ('roomA', (select public.create_room('HostA', null, 2)));

select is(
  (select max_players from public.rooms where id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid),
  2,
  'create_room persists the chosen max_players instead of defaulting to 4'
);

select throws_ok(
  $$select public.create_room('Nope', null, 5)$$,
  'P0001',
  'INVALID_PLAYER_COUNT',
  'create_room rejects a player count outside 2-4'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444402';
insert into test_state (key, value)
select 'joinA', public.join_room((select value->>'code' from test_state where key = 'roomA'), 'GuestA');
select results_eq(
  $$select seat_index from public.players
    where id = ((select value->>'playerId' from test_state where key = 'joinA'))::uuid$$,
  $$values (1)$$,
  'the second joiner takes the last of the two seats'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444403';
select throws_ok(
  $$select public.join_room((select value->>'code' from test_state where key = 'roomA'), 'StrangerA')$$,
  'P0001',
  'ROOM_FULL',
  'a third player cannot join a room capped at 2'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444401';
select throws_ok(
  $$select public.fill_bot(((select value->>'roomId' from test_state where key = 'roomA'))::uuid, 2)$$,
  'P0001',
  'INVALID_SEAT',
  'a bot cannot be added to a seat beyond max_players'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444402';
select throws_ok(
  $$select public.set_player_color(((select value->>'roomId' from test_state where key = 'roomA'))::uuid, 'yellow')$$,
  'P0001',
  'INVALID_SEAT',
  'choosing a color whose seat is beyond max_players fails'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444401';
select public.start_match(((select value->>'roomId' from test_state where key = 'roomA'))::uuid);
select is(
  (select count(*) from public.players where room_id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid),
  2::bigint,
  'start_match does not bot-fill past the room''s own max_players'
);
select is(
  (select count(*) from public.pawns where room_id = ((select value->>'roomId' from test_state where key = 'roomA'))::uuid),
  8::bigint,
  'only the 2 seated players are dealt pawns'
);

-- -------------------------------------------------------------------------
-- Room B: default 4-player room, exercising set_room_max_players.
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444404';
insert into test_state (key, value)
values ('roomB', (select public.create_room('HostB')));

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444405';
insert into test_state (key, value)
select 'joinB', public.join_room((select value->>'code' from test_state where key = 'roomB'), 'GuestB');

select throws_ok(
  $$select public.set_room_max_players(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 2)$$,
  'P0001',
  'NOT_HOST',
  'only the host can change the room''s player count'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444404';
select public.fill_bot(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 2);
select throws_ok(
  $$select public.set_room_max_players(((select value->>'roomId' from test_state where key = 'roomB'))::uuid, 2)$$,
  'P0001',
  'TOO_MANY_SEATED',
  'the player count cannot be lowered below the number of seated players'
);

select * from finish();
rollback;
