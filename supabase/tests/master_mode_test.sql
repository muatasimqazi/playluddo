-- pgTAP tests for supabase/migrations/20260928200000_master_mode.sql and
-- 20260928200100_master_mode_roll.sql: until a player has captured, their
-- pieces stop at the last shared square instead of going into the home
-- column, and capturing lifts that for the rest of the match.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(12);

-- Red spread out: one mid-track, one on the last shared square, one already
-- inside the home column, one in base.
create function pg_temp.board() returns jsonb language sql immutable as $$
  select '[
    {"id":"r0","color":"red","index":0,"state":"track","pathIndex":48},
    {"id":"r1","color":"red","index":1,"state":"track","pathIndex":50},
    {"id":"r2","color":"red","index":2,"state":"home_lane","pathIndex":52},
    {"id":"r3","color":"red","index":3,"state":"nest","pathIndex":null}
  ]'::jsonb;
$$;
create function pg_temp.targets(die int, held boolean) returns text[] language sql as $$
  select array_agg(m->>'toTileId' order by m->>'pawnId')
  from jsonb_array_elements(
    private.ludo_legal_moves(pg_temp.board(), 'red', die, '{"captureToEnterHome": true}'::jsonb, not held)
  ) m;
$$;

select is(
  (private.ludo_default_rules()->>'captureToEnterHome')::boolean, false,
  'the classic game is still the default'
);

-- Held back: a 4 takes the piece on 48 to 52 normally, but it stops on 50.
select is(
  pg_temp.targets(4, true), array['track:50','home:red:5'],
  'held back, a piece on the track stops at the last shared square'
);
select is(
  pg_temp.targets(4, false), array['home:red:1','home:red:3','home:red:5'],
  'once captured, every piece carries on into the home column'
);

-- The piece already inside the home column is never held back.
select is(
  (select count(*)::int from jsonb_array_elements(
     private.ludo_legal_moves(pg_temp.board(), 'red', 1, '{"captureToEnterHome": true}'::jsonb, false)) m
   where m->>'pawnId' = 'r2'),
  1,
  'a piece already in the home column keeps moving'
);

-- A piece sitting on the last shared square has nowhere to go while held back.
select is(
  (select count(*)::int from jsonb_array_elements(
     private.ludo_legal_moves(pg_temp.board(), 'red', 3, '{"captureToEnterHome": true}'::jsonb, false)) m
   where m->>'pawnId' = 'r1'),
  0,
  'a piece already on that square has no move at all'
);
select is(
  (select count(*)::int from jsonb_array_elements(
     private.ludo_legal_moves(pg_temp.board(), 'red', 3, '{"captureToEnterHome": true}'::jsonb, true)) m
   where m->>'pawnId' = 'r1'),
  1,
  'but moves again once its player has captured'
);

-- Coming out of base is never held back.
select is(
  (select m->>'toTileId' from jsonb_array_elements(
     private.ludo_legal_moves(pg_temp.board(), 'red', 6, '{"captureToEnterHome": true}'::jsonb, false)) m
   where m->>'pawnId' = 'r3'),
  'track:0',
  'a piece still comes out of base on a six'
);

-- Nothing changes when the rule is off.
select is(
  private.ludo_legal_moves(pg_temp.board(), 'red', 4, '{"captureToEnterHome": false}'::jsonb, false),
  private.ludo_legal_moves(pg_temp.board(), 'red', 4),
  'with the rule off the classic game is untouched'
);
select is(
  private.ludo_legal_moves(pg_temp.board(), 'red', 4, null, false),
  private.ludo_legal_moves(pg_temp.board(), 'red', 4),
  'and a room with no rules on record plays the classic game'
);

-- -------------------------------------------------------------------------
-- A capture is recorded, and the table says so
-- -------------------------------------------------------------------------

insert into auth.users (id, is_anonymous) values
  ('d2222222-0000-0000-0000-000000000001', true),
  ('d2222222-0000-0000-0000-000000000002', true);
create temporary table mm_state (key text primary key, value jsonb);
grant select, insert on mm_state to authenticated;
create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from mm_state where key = 'room';
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'd2222222-0000-0000-0000-000000000001';
insert into mm_state values ('room', public.create_room('Hosty', null, 2));
select lives_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"captureToEnterHome": true}'),
  'a host can ask for Master mode'
);
set local request.jwt.claim.sub = 'd2222222-0000-0000-0000-000000000002';
insert into mm_state select 'guest', public.join_room((select value->>'code' from mm_state where key = 'room'), 'Guest');
set local request.jwt.claim.sub = 'd2222222-0000-0000-0000-000000000001';
select public.start_match(pg_temp.room());
reset role;

select is(
  (select count(*)::int from public.players where room_id = pg_temp.room() and has_captured), 0,
  'nobody has captured yet'
);
select is(
  (select p->>'hasCaptured' from jsonb_array_elements(
     private.ludo_room_state_json(pg_temp.room())->'players') p
   where p->>'displayName' = 'Hosty'),
  'false',
  'and the table says so, so opponents can see who is held back'
);

select * from finish();
rollback;
