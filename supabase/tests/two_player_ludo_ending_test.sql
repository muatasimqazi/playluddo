-- Regression coverage for
-- supabase/migrations/20260928030000_two_player_ludo_ends_on_first_win.sql:
-- a 2-player Ludo match ends when the first player finishes, instead of
-- leaving the loser rolling alone. 3-4 player matches playing on for every
-- placement are covered by rpc_flow_test.sql.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(4);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555501', 'host-2p@test.com'),
  ('55555555-5555-5555-5555-555555555502', 'guest-2p@test.com');

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555501';
insert into test_state (key, value)
values ('room', (select public.create_room('Host', null, 2)));

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555502';
insert into test_state (key, value)
select 'join', public.join_room((select value->>'code' from test_state where key = 'room'), 'Guest');

set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555501';
select public.start_match(((select value->>'roomId' from test_state where key = 'room'))::uuid);

-- Engineer the host one roll from finishing: three pawns home, the fourth
-- three cells from the end of its home lane, with a 3 waiting to be moved.
reset role;

update public.pawns set state = 'finished', path_index = 56
where player_id = (select value->>'playerId' from test_state where key = 'room')::uuid
  and pawn_index in (1, 2, 3);

update public.pawns set state = 'home_lane', path_index = 53
where player_id = (select value->>'playerId' from test_state where key = 'room')::uuid
  and pawn_index = 0;

update public.rooms
set active_dice_value = 3, turn_phase = 'awaiting_move',
    turn_player_id = (select value->>'playerId' from test_state where key = 'room')::uuid
where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid;

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555501';
select public.request_move(
  ((select value->>'roomId' from test_state where key = 'room'))::uuid,
  (select id from public.pawns
   where player_id = (select value->>'playerId' from test_state where key = 'room')::uuid
     and pawn_index = 0)
);

reset role;

select results_eq(
  $$select status, match_end_reason, turn_phase from public.rooms
    where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid$$,
  $$values ('summary'::text, 'completed'::text, 'complete'::text)$$,
  'a 2-player match ends as soon as the first player finishes'
);

select is(
  (select winner_ids from public.rooms where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid),
  array[(select value->>'playerId' from test_state where key = 'room')::uuid],
  'the finisher is the only recorded placement'
);

select is(
  (select count(*)::int from public.match_events
   where room_id = ((select value->>'roomId' from test_state where key = 'room'))::uuid
     and event_type = 'match_completed'),
  1,
  'a match_completed event is recorded once'
);

select is(
  (select payload->>'winnerId' from public.match_events
   where room_id = ((select value->>'roomId' from test_state where key = 'room'))::uuid
     and event_type = 'match_completed'),
  (select value->>'playerId' from test_state where key = 'room'),
  'match_completed names the finisher as the winner'
);

select * from finish();
rollback;
