-- pgTAP tests for supabase/migrations/20261002100000_dice_used_in_order.sql:
-- the turn's dice are used strictly in order, so a six that can't move
-- neither earns the roll after it nor lets a later die through.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(9);

insert into auth.users (id, is_anonymous) values
  ('d3333333-0000-0000-0000-000000000001', true),
  ('d3333333-0000-0000-0000-000000000002', true);
create temporary table dio_state (key text primary key, value jsonb);
grant select, insert on dio_state to authenticated;
create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from dio_state where key = 'room';
$$;
create function pg_temp.mover() returns uuid language sql as $$
  select turn_player_id from public.rooms where id = pg_temp.room();
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'd3333333-0000-0000-0000-000000000001';
insert into dio_state values ('room', public.create_room('Hosty', null, 2));
set local request.jwt.claim.sub = 'd3333333-0000-0000-0000-000000000002';
insert into dio_state select 'guest', public.join_room((select value->>'code' from dio_state where key = 'room'), 'Guest');
set local request.jwt.claim.sub = 'd3333333-0000-0000-0000-000000000001';
select public.start_match(pg_temp.room());
reset role;

-- The dice come from this queue, in order; the stub is rolled back with the test.
create temporary table dio_dice (n serial primary key, value int not null);
create or replace function private.roll_match_die(p_room_id uuid)
returns int language plpgsql volatile as $$
declare v int;
begin
  delete from dio_dice where n = (select min(n) from dio_dice) returning value into v;
  return v;
end;
$$;

-- The player to move has one piece left, in its home lane, needing a 3.
insert into dio_state select 'mover', to_jsonb(pg_temp.mover());
update public.pawns set state = 'finished', path_index = 56
where player_id = pg_temp.mover() and pawn_index in (1, 2, 3);
update public.pawns set state = 'home_lane', path_index = 53
where player_id = pg_temp.mover() and pawn_index = 0;

-- -------------------------------------------------------------------------
-- A six nothing can move ends the turn instead of rolling again
-- -------------------------------------------------------------------------

insert into dio_dice (value) values (6);
select private.ludo_perform_ludo_roll(pg_temp.room(), pg_temp.mover());

select isnt(
  pg_temp.mover(), (select (value#>>'{}')::uuid from dio_state where key = 'mover'),
  'a six the last piece can''t use passes the turn'
);
select is(
  (select pending_dice from public.rooms where id = pg_temp.room()), '{}'::integer[],
  'and leaves no dice in hand'
);
select is(
  (select consecutive_sixes from public.rooms where id = pg_temp.room()), 0,
  'or a six streak'
);

-- -------------------------------------------------------------------------
-- A six that can move still rolls again
-- -------------------------------------------------------------------------

update public.rooms
set turn_player_id = (select (value#>>'{}')::uuid from dio_state where key = 'mover'),
    turn_phase = 'awaiting_roll', consecutive_sixes = 0, pending_dice = '{}'
where id = pg_temp.room();
-- Six back from its home lane, so the first six takes it in.
update public.pawns set state = 'track', path_index = 47
where player_id = pg_temp.mover() and pawn_index = 0;

insert into dio_dice (value) values (6);
select private.ludo_perform_ludo_roll(pg_temp.room(), pg_temp.mover());

select is(
  (select turn_phase from public.rooms where id = pg_temp.room()), 'awaiting_roll',
  'a six that can move rolls again'
);
select is(
  (select pending_dice from public.rooms where id = pg_temp.room()), array[6],
  'holding the six for later'
);

-- -------------------------------------------------------------------------
-- 6, 6, 3: once the first six takes the piece in, the second can't move it,
-- and the 3 that would get it home is lost
-- -------------------------------------------------------------------------

insert into dio_dice (value) values (6), (3);
select private.ludo_perform_ludo_roll(pg_temp.room(), pg_temp.mover());
select private.ludo_perform_ludo_roll(pg_temp.room(), pg_temp.mover());

select is(
  (select active_dice_value from public.rooms where id = pg_temp.room()), 6,
  'the first six is moved first'
);
select is(
  (select pending_dice from public.rooms where id = pg_temp.room()), array[6, 3],
  'with the six and the 3 waiting, in order'
);

select private.ludo_perform_move(pg_temp.room(), pg_temp.mover(),
  (select id from public.pawns where player_id = pg_temp.mover() and pawn_index = 0));

select is(
  (select state from public.pawns where player_id = (select (value#>>'{}')::uuid from dio_state where key = 'mover') and pawn_index = 0),
  'home_lane',
  'the piece is in its home lane, not home'
);
select isnt(
  pg_temp.mover(), (select (value#>>'{}')::uuid from dio_state where key = 'mover'),
  'the second six can''t move, so the turn passes without the 3'
);

select * from finish();
rollback;
