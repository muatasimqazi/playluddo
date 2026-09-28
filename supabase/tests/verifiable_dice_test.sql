-- pgTAP tests for supabase/migrations/20260928070000_verifiable_dice.sql:
-- the commitment is published before play, every roll follows from the
-- seed at consecutive indices, and the seed stays hidden until the match
-- ends. The browser's copy of the protocol is checked against
-- private.dice_face in tests/parity.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(14);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999901', 'host@dice.test'),
  ('99999999-9999-9999-9999-999999999902', 'guest@dice.test'),
  ('99999999-9999-9999-9999-999999999903', 'stranger@dice.test');

set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999901';
insert into test_state (key, value) values ('room', (select public.create_room('Host', null, 2)));
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999902';
insert into test_state (key, value)
select 'join', public.join_room((select value->>'code' from test_state where key = 'room'), 'Guest');
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999901';
select public.start_match(((select value->>'roomId' from test_state where key = 'room'))::uuid);
reset role;

insert into test_state (key, value)
select 'match', jsonb_build_object('id', current_match_id, 'room', id)
from public.rooms where id = ((select value->>'roomId' from test_state where key = 'room'))::uuid;

create function pg_temp.match_id() returns uuid language sql as $$
  select (value->>'id')::uuid from test_state where key = 'match';
$$;
create function pg_temp.room_id() returns uuid language sql as $$
  select (value->>'room')::uuid from test_state where key = 'match';
$$;

-- -------------------------------------------------------------------------
-- The commitment, before play
-- -------------------------------------------------------------------------

select is(
  (select dice_commitment from public.matches where id = pg_temp.match_id()),
  (select encode(extensions.digest(seed, 'sha256'), 'hex') from private.match_dice where match_id = pg_temp.match_id()),
  'the commitment is the SHA-256 of the match''s seed'
);

select is(
  (select length(seed) from private.match_dice where match_id = pg_temp.match_id()),
  32,
  'the seed is 32 bytes'
);

select is(
  (select payload->>'diceCommitment' from public.match_events
   where match_id = pg_temp.match_id() and event_type = 'match_started'),
  (select dice_commitment from public.matches where id = pg_temp.match_id()),
  'the commitment is published on match_started, before the first roll'
);

select is(
  private.ludo_room_state_json(pg_temp.room_id())->>'diceCommitment',
  (select dice_commitment from public.matches where id = pg_temp.match_id()),
  'the room state carries it too, so a device can remember it'
);

-- -------------------------------------------------------------------------
-- Every roll follows from the seed, at consecutive indices
-- -------------------------------------------------------------------------

select private.roll_match_die(pg_temp.room_id()) from generate_series(1, 5);

select is(
  (select roll_count from private.match_dice where match_id = pg_temp.match_id()),
  5,
  'each roll takes the next index'
);

-- Real rolls through the RPC: whoever's turn it is rolls, a few times.
create function pg_temp.roll_once() returns void language plpgsql as $$
declare v_user uuid;
begin
  select p.user_id into v_user from public.players p join public.rooms r on r.turn_player_id = p.id
  where r.id = pg_temp.room_id();
  update public.rooms set turn_phase = 'awaiting_roll', active_dice_value = null where id = pg_temp.room_id();
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform public.request_roll(pg_temp.room_id());
end;
$$;
select pg_temp.roll_once() from generate_series(1, 4);

select is(
  (select count(*)::int from public.match_events where match_id = pg_temp.match_id() and event_type = 'dice_rolled'),
  4,
  'four rolls were recorded'
);

-- The recorded rolls are indices 5, 6, 7, 8 (after the five direct draws).
select is(
  (select array_agg((payload->>'dieValue')::int order by sequence) from public.match_events
   where match_id = pg_temp.match_id() and event_type = 'dice_rolled'),
  (select array_agg(private.dice_face(d.seed, d.match_id, k) order by k)
   from private.match_dice d, generate_series(5, 8) k where d.match_id = pg_temp.match_id()),
  'every recorded roll is exactly the face its index derives from the seed'
);

select ok(
  (select bool_and(private.dice_face(decode(repeat('ab', 32), 'hex'), '00000000-0000-0000-0000-000000000001', k) between 1 and 6)
   from generate_series(0, 999) k),
  'derived faces are always 1-6'
);

select is(
  private.dice_face(decode(repeat('ab', 32), 'hex'), '00000000-0000-0000-0000-000000000001', 0),
  private.dice_face(decode(repeat('ab', 32), 'hex'), '00000000-0000-0000-0000-000000000001', 0),
  'the same seed, match and index always give the same face'
);

-- -------------------------------------------------------------------------
-- The seed stays hidden until the match ends
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999902';

select is(
  public.get_dice_proof(pg_temp.room_id())->'seed',
  'null'::jsonb,
  'during the match, the proof has no seed'
);

select throws_ok($$select * from private.match_dice$$, '42501', null, 'players cannot read seeds directly');

reset role;
update public.rooms set status = 'summary', match_end_reason = 'completed', turn_phase = 'complete'
where id = pg_temp.room_id();
insert into test_state (key, value)
select 'seed', to_jsonb(encode(seed, 'hex')) from private.match_dice where match_id = pg_temp.match_id();
set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999902';

select is(
  public.get_dice_proof(pg_temp.room_id())->>'seed',
  (select value #>> '{}' from test_state where key = 'seed'),
  'once the match ends, the seed is revealed'
);

select is(
  jsonb_array_length(public.get_dice_proof(pg_temp.room_id())->'rolls'),
  4,
  'the proof lists every recorded roll'
);

set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999903';
select throws_ok(
  format('select public.get_dice_proof(%L)', pg_temp.room_id()),
  'P0001', 'ROOM_NOT_FOUND',
  'someone not at the table cannot read the proof'
);

select * from finish();
rollback;
