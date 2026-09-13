-- pgTAP tests for private.ludo_legal_moves() in
-- supabase/migrations/20260913215503_rules_engine.sql. Mirrors the
-- "getLegalMoves" describe blocks in tests/rules-engine-ts/rules.test.ts.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(9);

-- Test-local helpers (rolled back with the rest of this transaction; not
-- part of the app schema). Mirror lib/board/rules.test.ts's pawn()/makeBoard().
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

select is(
  jsonb_array_length(private.ludo_legal_moves(private.ludo_test_board(), 'red', 5)),
  0,
  'no legal moves without a 6 while everyone is in the nest'
);

select is(
  jsonb_array_length(private.ludo_legal_moves(private.ludo_test_board(), 'red', 6)),
  4,
  'all 4 nest pawns are candidate moves on a 6'
);

select is(
  (select move->>'toTileId' from jsonb_array_elements(
    private.ludo_legal_moves(private.ludo_test_board(jsonb_build_object('red-0', private.ludo_test_pawn('red-0', 'red', 0, 'track', 6))), 'red', 4)
  ) as move where move->>'pawnId' = 'red-0'),
  'track:10',
  'advances a pawn by the die value'
);

select is(
  (select count(*) from jsonb_array_elements(
    private.ludo_legal_moves(private.ludo_test_board(jsonb_build_object('red-0', private.ludo_test_pawn('red-0', 'red', 0, 'home_lane', 53))), 'red', 4)
  ) as move where move->>'pawnId' = 'red-0'),
  0::bigint,
  'excludes a pawn whose move would overshoot the final home cell'
);

select is(
  (select (move->>'finishesPawn')::boolean from jsonb_array_elements(
    private.ludo_legal_moves(private.ludo_test_board(jsonb_build_object('red-0', private.ludo_test_pawn('red-0', 'red', 0, 'home_lane', 53))), 'red', 3)
  ) as move where move->>'pawnId' = 'red-0'),
  true,
  'finishes a pawn on the exact roll'
);

select is(
  (select move->'capturesPawnIds' from jsonb_array_elements(
    private.ludo_legal_moves(private.ludo_test_board(jsonb_build_object(
      'red-0', private.ludo_test_pawn('red-0', 'red', 0, 'track', 6),
      'green-0', private.ludo_test_pawn('green-0', 'green', 0, 'track', 49)
    )), 'red', 4)
  ) as move where move->>'pawnId' = 'red-0'),
  '["green-0"]'::jsonb,
  'captures a single opponent pawn landed on exactly'
);

select is(
  (select move->'capturesPawnIds' from jsonb_array_elements(
    private.ludo_legal_moves(private.ludo_test_board(jsonb_build_object(
      'red-0', private.ludo_test_pawn('red-0', 'red', 0, 'track', 6),
      'green-0', private.ludo_test_pawn('green-0', 'green', 0, 'track', 49),
      'green-1', private.ludo_test_pawn('green-1', 'green', 1, 'track', 49)
    )), 'red', 4)
  ) as move where move->>'pawnId' = 'red-0'),
  '["green-0", "green-1"]'::jsonb,
  'captures every pawn in a stack on the same non-safe cell'
);

select is(
  (select move->'capturesPawnIds' from jsonb_array_elements(
    private.ludo_legal_moves(private.ludo_test_board(jsonb_build_object(
      'red-0', private.ludo_test_pawn('red-0', 'red', 0, 'track', 4),
      'green-0', private.ludo_test_pawn('green-0', 'green', 0, 'track', 47)
    )), 'red', 4)
  ) as move where move->>'pawnId' = 'red-0'),
  '[]'::jsonb,
  'never captures on a safe cell'
);

select is(
  (select jsonb_agg(move->>'pawnId' order by move->>'pawnId') from jsonb_array_elements(
    private.ludo_legal_moves(private.ludo_test_board(jsonb_build_object(
      'red-0', private.ludo_test_pawn('red-0', 'red', 0, 'track', 5),
      'red-1', private.ludo_test_pawn('red-1', 'red', 1, 'track', 5)
    )), 'red', 3)
  ) as move),
  '["red-0", "red-1"]'::jsonb,
  'does not block movement onto/through a tile already holding 2+ pawns of one color (no blockade rule)'
);

select * from finish();
rollback;
