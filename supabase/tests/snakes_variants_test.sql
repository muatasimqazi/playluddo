-- pgTAP tests for supabase/migrations/20260928210000_snakes_variants.sql:
-- the two Snakes & Ladders house rules (F2.6). Both off by default.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(8);

create function pg_temp.off_board() returns jsonb language sql immutable as $$
  select '[{"id":"s0","color":"red","index":0,"state":"nest","pathIndex":null}]'::jsonb;
$$;
create function pg_temp.near_end() returns jsonb language sql immutable as $$
  select '[{"id":"s0","color":"red","index":0,"state":"track","pathIndex":97}]'::jsonb;
$$;

select ok(
  private.ludo_default_rules() @> '{"snakesAnyRollToStart": false, "snakesBounceBack": false}'::jsonb,
  'both variants are off by default'
);

-- Getting on the board.
select is(private.snakes_move(pg_temp.off_board(), 'red', 3), null, 'normally only a six starts a piece');
select is(
  private.snakes_move(pg_temp.off_board(), 'red', 3, '{"snakesAnyRollToStart": true}'::jsonb)->>'toTileId',
  'snakes:23',
  'with any roll to start, a 3 puts the piece on square 3 and up the ladder to 23'
);
select is(
  private.snakes_move(pg_temp.off_board(), 'red', 6, '{"snakesAnyRollToStart": true}'::jsonb)->>'toTileId',
  'snakes:6',
  'and a six still works'
);

-- Overshooting 100.
select is(private.snakes_move(pg_temp.near_end(), 'red', 5), null, 'normally overshooting 100 is no move at all');
select is(
  private.snakes_move(pg_temp.near_end(), 'red', 5, '{"snakesBounceBack": true}'::jsonb)->>'toTileId',
  -- 97 + 5 bounces off 100 onto 98, which is the head of a snake down to 38.
  'snakes:38',
  'bouncing back off 100 lands on 98, and the snake there takes it to 38'
);
select is(
  (private.snakes_move(pg_temp.near_end(), 'red', 3, '{"snakesBounceBack": true}'::jsonb)->>'finishesPawn')::boolean,
  true,
  'an exact roll still wins'
);
select is(
  private.snakes_move(pg_temp.near_end(), 'red', 5, '{"snakesBounceBack": false}'::jsonb),
  private.snakes_move(pg_temp.near_end(), 'red', 5),
  'with the rule off the game is unchanged'
);

select * from finish();
rollback;
