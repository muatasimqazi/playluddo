-- pgTAP tests for supabase/migrations/20260913232948_m4_rematch.sql.
-- Run with `supabase test db`.

begin;
select plan(8);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'p1@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'p2@test.com');

insert into public.rooms (id, code, status) values
  ('aaaaaaaa-0000-0000-0000-000000000009', 'REMATCH', 'summary');

insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('bbbbbbbb-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000009', 0,
   '11111111-1111-1111-1111-111111111111', 'P1', 'red', 'connected', false),
  ('bbbbbbbb-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000009', 1,
   '22222222-2222-2222-2222-222222222222', 'P2', 'green', 'connected', false),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000009', 2,
   null, 'Bot 3', 'yellow', 'bot', true);

insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
select 'aaaaaaaa-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000009', gs, 'finished', 56
from generate_series(0, 3) as gs;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$select public.request_rematch('cccccccc-0000-0000-0000-000000000000'::uuid)$$,
  'P0001', 'ROOM_NOT_FOUND',
  'requesting a rematch in a nonexistent room fails'
);

select public.request_rematch('aaaaaaaa-0000-0000-0000-000000000009'::uuid);
select is(
  (select rematch_ready from public.players where id = 'bbbbbbbb-0000-0000-0000-000000000009'),
  true, 'request_rematch marks the caller ready'
);
select is(
  (select status from public.rooms where id = 'aaaaaaaa-0000-0000-0000-000000000009'),
  'summary', 'the match is not yet reset — only one of two connected humans has voted'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$select public.accept_rematch('aaaaaaaa-0000-0000-0000-000000000000'::uuid)$$,
  'P0001', 'ROOM_NOT_FOUND',
  'a garbage room id still fails cleanly'
);

select public.accept_rematch('aaaaaaaa-0000-0000-0000-000000000009'::uuid);

select is(
  (select status from public.rooms where id = 'aaaaaaaa-0000-0000-0000-000000000009'),
  'lobby', 'once both connected humans are ready, the room resets to lobby (bots never had to vote)'
);
select is(
  (select count(*) from public.pawns where room_id = 'aaaaaaaa-0000-0000-0000-000000000009'),
  0::bigint, 'pawns are cleared on rematch reset'
);
select results_eq(
  $$select rematch_ready, missed_decision_count from public.players
    where id = 'bbbbbbbb-0000-0000-0000-000000000009'$$,
  $$values (false, 0)$$,
  'per-player rematch/miss state is reset'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$select public.request_rematch('aaaaaaaa-0000-0000-0000-000000000009'::uuid)$$,
  'P0001', 'ROOM_NOT_IN_SUMMARY',
  'cannot request a rematch on a room that already reset to lobby'
);

select * from finish();
rollback;
