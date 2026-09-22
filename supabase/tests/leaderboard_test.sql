-- pgTAP tests for supabase/migrations/20260922010000_leaderboard.sql.
-- Run with `supabase test db`.

begin;
select plan(12);

insert into auth.users (id, email, is_anonymous) values
  ('11111111-1111-1111-1111-111111111141', 'alice@test.com', false),
  ('22222222-2222-2222-2222-222222222242', 'bob@test.com', false),
  ('33333333-3333-3333-3333-333333333343', 'carol@test.com', false),
  ('44444444-4444-4444-4444-444444444444', null, true);

insert into public.rooms (id, code, status) values
  ('aaaaaaaa-0000-0000-0000-000000000041', 'LBTEST1', 'in_game'),
  ('aaaaaaaa-0000-0000-0000-000000000042', 'LBTEST2', 'in_game');

insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('bbbbbbbb-0000-0000-0000-000000000041', 'aaaaaaaa-0000-0000-0000-000000000041', 0,
   '11111111-1111-1111-1111-111111111141', 'Alice', 'red', 'connected', false),
  ('bbbbbbbb-0000-0000-0000-000000000042', 'aaaaaaaa-0000-0000-0000-000000000041', 1,
   '22222222-2222-2222-2222-222222222242', 'Bob', 'green', 'connected', false),
  ('bbbbbbbb-0000-0000-0000-000000000043', 'aaaaaaaa-0000-0000-0000-000000000042', 0,
   '44444444-4444-4444-4444-444444444444', 'Guest', 'red', 'connected', false),
  ('bbbbbbbb-0000-0000-0000-000000000044', 'aaaaaaaa-0000-0000-0000-000000000042', 1,
   null, 'Bot', 'green', 'bot', true);

-- A team of alice+bob, seeded directly rather than through create_team/
-- join_team so the team id is a known literal for the assertions below.
insert into public.teams (id, name, owner_user_id) values
  ('cccccccc-0000-0000-0000-000000000041', 'LB Team', '11111111-1111-1111-1111-111111111141');
insert into public.team_members (team_id, user_id, role, display_name) values
  ('cccccccc-0000-0000-0000-000000000041', '11111111-1111-1111-1111-111111111141', 'owner', 'Alice'),
  ('cccccccc-0000-0000-0000-000000000041', '22222222-2222-2222-2222-222222222242', 'member', 'Bob');

-- Carol out-scores everyone globally but is not on the team above.
insert into public.player_stats (user_id, wins) values
  ('33333333-3333-3333-3333-333333333343', 5);

-- Alice wins the first match.
update public.rooms set status = 'summary', match_end_reason = 'completed',
  winner_ids = array['bbbbbbbb-0000-0000-0000-000000000041'::uuid]
where id = 'aaaaaaaa-0000-0000-0000-000000000041';
select is(
  (select wins from public.player_stats where user_id = '11111111-1111-1111-1111-111111111141'),
  1, 'a completed match credits the winner with a win'
);

-- A rematch reset (status back to lobby) must not itself change the count.
update public.rooms set status = 'lobby', match_end_reason = null, winner_ids = '{}'
where id = 'aaaaaaaa-0000-0000-0000-000000000041';
select is(
  (select wins from public.player_stats where user_id = '11111111-1111-1111-1111-111111111141'),
  1, 'resetting a room for a rematch does not change win counts'
);

-- Alice wins the rematch too -- exactly one more win, not a double count.
update public.rooms set status = 'summary', match_end_reason = 'completed',
  winner_ids = array['bbbbbbbb-0000-0000-0000-000000000041'::uuid]
where id = 'aaaaaaaa-0000-0000-0000-000000000041';
select is(
  (select wins from public.player_stats where user_id = '11111111-1111-1111-1111-111111111141'),
  2, 'winning a second, separate match accumulates rather than resetting'
);

-- Bob wins a match of his own, on the same room after another reset.
update public.rooms set status = 'lobby', match_end_reason = null, winner_ids = '{}'
where id = 'aaaaaaaa-0000-0000-0000-000000000041';
update public.rooms set status = 'summary', match_end_reason = 'completed',
  winner_ids = array['bbbbbbbb-0000-0000-0000-000000000042'::uuid]
where id = 'aaaaaaaa-0000-0000-0000-000000000041';
select is(
  (select wins from public.player_stats where user_id = '22222222-2222-2222-2222-222222222242'),
  1, 'a different winner is credited independently'
);

-- A guest (anonymous) winner never accrues a leaderboard row.
update public.rooms set status = 'summary', match_end_reason = 'completed',
  winner_ids = array['bbbbbbbb-0000-0000-0000-000000000043'::uuid]
where id = 'aaaaaaaa-0000-0000-0000-000000000042';
select is(
  (select count(*) from public.player_stats where user_id = '44444444-4444-4444-4444-444444444444'),
  0::bigint, 'an anonymous guest winner is never credited'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111141';

select throws_ok(
  $$select * from public.player_stats$$,
  '42501', null,
  'the stats table cannot be queried directly'
);
select is(
  jsonb_array_length(public.get_leaderboard()),
  3, 'the global leaderboard lists every winner (including carol) and excludes the guest'
);
select is(
  (public.get_leaderboard()->0->>'userId'),
  '33333333-3333-3333-3333-333333333343',
  'the player with more wins ranks first'
);
select is(
  jsonb_array_length(public.get_leaderboard('cccccccc-0000-0000-0000-000000000041'::uuid)),
  2, 'a team-scoped leaderboard excludes a higher-scoring non-member'
);

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333343';
select throws_ok(
  $$select public.get_leaderboard('cccccccc-0000-0000-0000-000000000041'::uuid)$$,
  'P0001', 'NOT_TEAM_MEMBER',
  'a non-member cannot view a team leaderboard'
);
select is(
  public.get_my_wins(), 5, 'a player can look up their own win count directly'
);

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select is(
  public.get_my_wins(), 0, 'a guest with no stats row reports zero wins, not an error'
);

select * from finish();
rollback;
