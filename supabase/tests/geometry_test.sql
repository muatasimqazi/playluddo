-- pgTAP tests for the geometry functions in
-- supabase/migrations/20260913215503_rules_engine.sql. Mirrors
-- tests/rules-engine-ts/geometry.test.ts. Run with `supabase test db`
-- (requires `supabase start`). Each test file is its own rolled-back
-- transaction, per the Supabase CLI's pgTAP runner.

begin;
select plan(12);

select is(private.ludo_entry_offset('red'), 0, 'red enters at 0');
select is(private.ludo_entry_offset('green'), 13, 'green enters at 13');
select is(private.ludo_entry_offset('yellow'), 26, 'yellow enters at 26');
select is(private.ludo_entry_offset('blue'), 39, 'blue enters at 39');

select ok(private.ludo_is_safe_cell(0), 'cell 0 is safe');
select ok(private.ludo_is_safe_cell(8), 'cell 8 is safe');
select ok(not private.ludo_is_safe_cell(10), 'cell 10 is not safe');
select is(
  (select count(*) from unnest(array[0, 8, 13, 21, 26, 34, 39, 47]) c where private.ludo_is_safe_cell(c)),
  8::bigint,
  'exactly 8 safe cells, per the confirmed design mockups'
);

select is(private.ludo_path_index_to_tile_id('red', null), 'nest:red', 'nest tile id');
select is(private.ludo_path_index_to_tile_id('red', 0), 'track:0', 'red entry tile id');
select is(private.ludo_path_index_to_tile_id('red', 56), 'home:red:5', 'red final home tile id');
select is(private.ludo_tile_id_to_path_index('red', 'track:10'), 10, 'round trips a track tile id for red (offset 0)');

select * from finish();
rollback;
