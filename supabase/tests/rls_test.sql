-- pgTAP tests for the RLS policies in
-- supabase/migrations/20260913222114_rls_policies.sql — direct table-access
-- denial, since that's the actual security boundary (docs/PRD.md Section
-- 6.2/11: "no client can submit a final outcome... every intent rejected
-- unless it comes from the session that authenticates for the seat").
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(9);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@test.com');

-- Seed a room + seat directly, bypassing RLS as the migration-owner role
-- (this transaction runs as postgres, which bypasses RLS by default).
insert into public.rooms (id, code, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TEST01', 'lobby');
insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0,
   '11111111-1111-1111-1111-111111111111', 'Host', 'red', 'connected', false);

-- anon: no grant at all, blocked before any policy runs.
set local role anon;
select throws_ok(
  $$select * from public.rooms$$,
  '42501',
  null,
  'anon cannot read rooms'
);
select throws_ok(
  $$insert into public.rooms (code, status) values ('HACKED', 'lobby')$$,
  '42501',
  null,
  'anon cannot create a room'
);

-- authenticated, but not seated anywhere: has the grant, RLS is what stops them.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select is_empty(
  $$select * from public.rooms where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'a stranger cannot read a room they are not seated in'
);
select is_empty(
  $$select * from public.players where room_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'a stranger cannot read seats in a room they are not seated in'
);
select throws_ok(
  $$insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '22222222-2222-2222-2222-222222222222', 'Stranger', 'green', 'connected', false)$$,
  '42501',
  null,
  'a stranger cannot seat themselves directly (must go through join_room)'
);
select throws_ok(
  $$update public.rooms set status = 'in_game' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'a stranger cannot directly mutate room state (must go through an RPC)'
);

-- the seated host: RLS grants them exactly their own room.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select isnt_empty(
  $$select * from public.rooms where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'a seated player can read their own room'
);
select isnt_empty(
  $$select * from public.players where room_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'a seated player can read seats in their own room'
);
select throws_ok(
  $$update public.rooms set status = 'in_game' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  '42501',
  null,
  'even the seated host cannot directly mutate room state (must go through start_match)'
);

select * from finish();
rollback;
