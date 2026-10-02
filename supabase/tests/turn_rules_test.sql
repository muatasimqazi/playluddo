-- pgTAP tests for the bonus-roll, six-streak, apply-move, win, and ranking
-- functions in supabase/migrations/20260913215503_rules_engine.sql. Mirrors
-- the remaining describe blocks in tests/rules-engine-ts/rules.test.ts.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(15);

create function private.ludo_test_pawn(p_id text, p_color text, p_index int, p_state text, p_path_index int)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'color', p_color, 'index', p_index, 'state', p_state, 'pathIndex', p_path_index);
$$;

create function private.ludo_test_board(p_overrides jsonb default '{}'::jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_color text;
  v_index int;
  v_id text;
  v_pawns jsonb := '[]'::jsonb;
begin
  foreach v_color in array array['red', 'green', 'yellow', 'blue'] loop
    for v_index in 0..3 loop
      v_id := v_color || '-' || v_index;
      if p_overrides ? v_id then
        v_pawns := v_pawns || (p_overrides -> v_id);
      else
        v_pawns := v_pawns || private.ludo_test_pawn(v_id, v_color, v_index, 'nest', null);
      end if;
    end loop;
  end loop;
  return v_pawns;
end;
$$;

-- bonus-roll triggers (PRD 4.2 + F1.5): a capture, or a pawn getting home
-- when the room's rule is on (the default). A six's extra roll comes before
-- it moves, so the move itself earns nothing for it. Never stacked.
select ok(
  not private.ludo_earns_bonus_roll(jsonb_build_object(
    'pawnId', 'x', 'fromTileId', 'track:1', 'toTileId', 'track:2', 'capturesPawnIds', '[]'::jsonb, 'finishesPawn', false
  ), '{}'::jsonb),
  'grants no bonus roll for a plain move'
);

select ok(
  private.ludo_earns_bonus_roll(jsonb_build_object(
    'pawnId', 'x', 'fromTileId', 'track:1', 'toTileId', 'track:2', 'capturesPawnIds', '["y"]'::jsonb, 'finishesPawn', false
  ), '{}'::jsonb),
  'grants a bonus roll on a capture'
);

select ok(
  private.ludo_earns_bonus_roll(jsonb_build_object(
    'pawnId', 'x', 'fromTileId', 'track:1', 'toTileId', 'track:2', 'capturesPawnIds', '["y"]'::jsonb, 'finishesPawn', true
  ), '{}'::jsonb),
  'still a single bonus roll when both a capture and getting home apply (no stacking)'
);

select ok(
  private.ludo_earns_bonus_roll(jsonb_build_object(
    'pawnId', 'x', 'fromTileId', 'home:red:4', 'toTileId', 'home:red:5', 'capturesPawnIds', '[]'::jsonb, 'finishesPawn', true
  ), '{}'::jsonb),
  'grants a bonus roll for getting a pawn home under the default rules'
);

select ok(
  not private.ludo_earns_bonus_roll(jsonb_build_object(
    'pawnId', 'x', 'fromTileId', 'home:red:4', 'toTileId', 'home:red:5', 'capturesPawnIds', '[]'::jsonb, 'finishesPawn', true
  ), '{"bonusRollOnFinish": false}'::jsonb),
  'does not grant a bonus roll for getting a pawn home when the host turned the rule off'
);

-- sixes rolled first, then moved by in order (PRD 4.2)
select is(
  private.ludo_next_playable_die(private.ludo_test_board(), 'red', array[6, 6, 3]) - 'legalMoves',
  '{"dieValue": 6, "rest": [6, 3]}'::jsonb,
  'moves by the first die, leaving the rest in the order rolled'
);

select is(
  private.ludo_next_playable_die(private.ludo_test_board(), 'red', array[4, 2]),
  null,
  'no die is playable with every pawn in its nest and no six'
);

-- consecutive sixes (PRD 4.2)
select is(private.ludo_evaluate_six_roll(2, 4), '{"consecutiveSixesAfter": 0, "cancelMove": false}'::jsonb, 'resets the streak on a non-six');
select is(private.ludo_evaluate_six_roll(0, 6), '{"consecutiveSixesAfter": 1, "cancelMove": false}'::jsonb, 'first six does not cancel');
select is(private.ludo_evaluate_six_roll(1, 6), '{"consecutiveSixesAfter": 2, "cancelMove": false}'::jsonb, 'second six does not cancel');
select is(private.ludo_evaluate_six_roll(2, 6), '{"consecutiveSixesAfter": 3, "cancelMove": true}'::jsonb, 'cancels all three on the third consecutive six');

-- apply_move
select is(
  (select p->>'state' from jsonb_array_elements(
    private.ludo_apply_move(
      private.ludo_test_board(jsonb_build_object(
        'red-0', private.ludo_test_pawn('red-0', 'red', 0, 'track', 6),
        'green-0', private.ludo_test_pawn('green-0', 'green', 0, 'track', 49)
      )),
      jsonb_build_object('pawnId', 'red-0', 'fromTileId', 'track:6', 'toTileId', 'track:10', 'capturesPawnIds', '["green-0"]'::jsonb, 'finishesPawn', false)
    )
  ) as p where p->>'id' = 'green-0'),
  'nest',
  'applyMove sends a captured pawn back to its nest'
);

-- win detection (PRD 4.4)
select ok(
  not private.ludo_is_match_won(
    private.ludo_test_board(jsonb_build_object(
      'red-0', private.ludo_test_pawn('red-0', 'red', 0, 'finished', 56),
      'red-1', private.ludo_test_pawn('red-1', 'red', 1, 'finished', 56),
      'red-2', private.ludo_test_pawn('red-2', 'red', 2, 'finished', 56)
    )),
    'red'
  ),
  'not yet won with only 3 of 4 pawns finished'
);

select ok(
  private.ludo_is_match_won(
    private.ludo_test_board(jsonb_build_object(
      'red-0', private.ludo_test_pawn('red-0', 'red', 0, 'finished', 56),
      'red-1', private.ludo_test_pawn('red-1', 'red', 1, 'finished', 56),
      'red-2', private.ludo_test_pawn('red-2', 'red', 2, 'finished', 56),
      'red-3', private.ludo_test_pawn('red-3', 'red', 3, 'finished', 56)
    )),
    'red'
  ),
  'won once all 4 pawns are finished'
);

-- ranking tiebreakers (PRD 4.4)
select is(
  private.ludo_rank_players('[
    {"id": "a", "pawnsFinished": 1, "totalProgress": 40, "turnOrder": 2},
    {"id": "b", "pawnsFinished": 2, "totalProgress": 10, "turnOrder": 1},
    {"id": "c", "pawnsFinished": 1, "totalProgress": 50, "turnOrder": 0},
    {"id": "d", "pawnsFinished": 1, "totalProgress": 50, "turnOrder": 3}
  ]'::jsonb),
  '["b", "c", "d", "a"]'::jsonb,
  'ranks by pawns finished, then total progress, then earlier turn order'
);

select * from finish();
rollback;
