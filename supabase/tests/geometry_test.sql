-- pgTAP tests for the geometry functions in
-- supabase/migrations/20260913215503_rules_engine.sql. Mirrors
-- tests/rules-engine-ts/geometry.test.ts. Run with `supabase test db`
-- (requires `supabase start`). Each test file is its own rolled-back
-- transaction, per the Supabase CLI's pgTAP runner.

begin;
select plan(22);

select is(private.ludo_entry_offset('red'), 0, 'red enters at 0');
select is(private.ludo_entry_offset('green'), 13, 'green enters at 13');
select is(private.ludo_entry_offset('yellow'), 26, 'yellow enters at 26');
select is(private.ludo_entry_offset('blue'), 39, 'blue enters at 39');

select ok(private.ludo_is_safe_cell(0), 'the entry cell (0) is itself safe, now that the ring is rotated so entry sits in its own arm');
select ok(private.ludo_is_safe_cell(8), 'cell 8 is safe');
select ok(not private.ludo_is_safe_cell(3), 'cell 3 is not safe under the rotated ring');
select ok(not private.ludo_is_safe_cell(10), 'cell 10 is not safe');
select is(
  (select count(*) from unnest(array[0, 8, 13, 21, 26, 34, 39, 47]) c where private.ludo_is_safe_cell(c)),
  8::bigint,
  'exactly 8 safe cells, same physical cells as designs/board-design.png, relabeled for the rotated ring'
);

select is(private.ludo_path_index_to_tile_id('red', null), 'nest:red', 'nest tile id');
select is(private.ludo_path_index_to_tile_id('red', 0), 'track:0', 'red entry tile id');
select is(private.ludo_path_index_to_tile_id('red', 56), 'home:red:5', 'red final home tile id');
select is(private.ludo_tile_id_to_path_index('red', 'track:10'), 10, 'round trips a track tile id for red (offset 0)');

-- F5.2: the 6-arm hexagonal board (5-6 players). Mirrors the hex cases in
-- tests/rules-engine-ts/geometry.test.ts and lib/board/boardSpec.ts BOARD_6.
select is(private.ludo_entry_offset('orange'), 52, 'orange (seat 4) enters at 52');
select is(private.ludo_entry_offset('black'), 65, 'black (seat 5) enters at 65');
select ok(private.ludo_is_safe_cell(52), 'orange entry (52) is safe');
select ok(private.ludo_is_safe_cell(73), 'black star (65+8=73) is safe');
select ok(not private.ludo_is_safe_cell(55), 'cell 55 is not safe on the hex ring');
select is(
  (select count(*) from generate_series(0, 77) c where private.ludo_is_safe_cell(c)),
  12::bigint,
  'exactly 12 safe cells on the 6-arm ring (2 per arm)'
);
select is(private.ludo_board_arms('[{"color":"orange"},{"color":"red"}]'::jsonb), 6, 'orange present => 6 arms');
select is(private.ludo_board_arms('[{"color":"red"},{"color":"yellow"}]'::jsonb), 4, 'no orange/black => 4 arms');
select is(private.ludo_path_index_to_tile_id('black', 76, 6), 'track:63', 'black last hex track cell -> global (65+76) mod 78 = 63');

select * from finish();
rollback;
