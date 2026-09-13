-- pgTAP tests for private.ludo_choose_bot_move() in
-- supabase/migrations/20260913215503_rules_engine.sql. Mirrors
-- tests/rules-engine-ts/bot.test.ts. Run with `supabase test db`
-- (requires `supabase start`).

begin;
select plan(5);

create function private.ludo_test_pawn(p_id text, p_color text, p_index int, p_state text, p_path_index int)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'color', p_color, 'index', p_index, 'state', p_state, 'pathIndex', p_path_index);
$$;

select is(
  private.ludo_choose_bot_move(
    '[
      {"pawnId": "red-1", "fromTileId": "track:6", "toTileId": "track:9", "capturesPawnIds": ["x", "y"], "finishesPawn": false},
      {"pawnId": "red-0", "fromTileId": "home:red:4", "toTileId": "home:red:5", "capturesPawnIds": [], "finishesPawn": true}
    ]'::jsonb,
    jsonb_build_array(private.ludo_test_pawn('red-0', 'red', 0, 'home_lane', 55), private.ludo_test_pawn('red-1', 'red', 1, 'track', 6))
  )->>'pawnId',
  'red-0',
  'prefers finishing a pawn over a bigger capture elsewhere'
);

select is(
  private.ludo_choose_bot_move(
    '[
      {"pawnId": "red-0", "fromTileId": "track:6", "toTileId": "track:9", "capturesPawnIds": ["x"], "finishesPawn": false},
      {"pawnId": "red-1", "fromTileId": "track:6", "toTileId": "track:9", "capturesPawnIds": ["x", "y"], "finishesPawn": false}
    ]'::jsonb,
    jsonb_build_array(private.ludo_test_pawn('red-0', 'red', 0, 'track', 6), private.ludo_test_pawn('red-1', 'red', 1, 'track', 6))
  )->>'pawnId',
  'red-1',
  'prefers more captures over fewer when nothing finishes'
);

select is(
  private.ludo_choose_bot_move(
    '[
      {"pawnId": "red-1", "fromTileId": "track:44", "toTileId": "track:50", "capturesPawnIds": [], "finishesPawn": false},
      {"pawnId": "red-0", "fromTileId": "nest:red", "toTileId": "track:0", "capturesPawnIds": [], "finishesPawn": false}
    ]'::jsonb,
    jsonb_build_array(private.ludo_test_pawn('red-0', 'red', 0, 'nest', null), private.ludo_test_pawn('red-1', 'red', 1, 'track', 44))
  )->>'pawnId',
  'red-0',
  'prefers exiting the nest on a 6 over an equally-uneventful track advance'
);

select is(
  private.ludo_choose_bot_move(
    '[
      {"pawnId": "red-0", "fromTileId": "track:6", "toTileId": "track:9", "capturesPawnIds": [], "finishesPawn": false},
      {"pawnId": "red-1", "fromTileId": "track:20", "toTileId": "track:23", "capturesPawnIds": [], "finishesPawn": false}
    ]'::jsonb,
    jsonb_build_array(private.ludo_test_pawn('red-0', 'red', 0, 'track', 6), private.ludo_test_pawn('red-1', 'red', 1, 'track', 20))
  )->>'pawnId',
  'red-1',
  'otherwise advances the pawn closest to finishing'
);

select ok(
  private.ludo_choose_bot_move('[]'::jsonb, '[]'::jsonb) is null,
  'returns null when there are no legal moves'
);

select * from finish();
rollback;
