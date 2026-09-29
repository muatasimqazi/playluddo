-- Master mode fix: only a piece still on the shared track is held back.
--
-- 20260928200000_master_mode.sql capped every target at the last shared
-- square, which dragged a piece already inside the home column backwards
-- onto the track. A piece can normally only reach the home column by
-- passing that square, but a game that starts pieces on the board (F2.1) or
-- a rule changed in the lobby can produce this board, and moving backwards
-- is never a move.

CREATE OR REPLACE FUNCTION private.ludo_legal_moves(p_pawns jsonb, p_color text, p_die_value integer, p_rules jsonb DEFAULT NULL::jsonb, p_has_captured boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v_pawn jsonb;
  v_state text;
  v_path_index int;
  v_target int;
  v_moves jsonb := '[]'::jsonb;
  v_captures jsonb;
  -- Master mode: this player has to capture before any piece goes home.
  v_held_back boolean := (private.ludo_resolve_rules(p_rules)->>'captureToEnterHome')::boolean
    and not coalesce(p_has_captured, false);
begin
  for v_pawn in select * from jsonb_array_elements(p_pawns)
  loop
    if v_pawn->>'color' <> p_color then
      continue;
    end if;

    v_state := v_pawn->>'state';

    if v_state = 'nest' then
      if p_die_value <> 6 then
        continue;
      end if;
      v_captures := private.ludo_captures_at(p_pawns, p_color, 0);
      v_moves := v_moves || jsonb_build_object(
        'pawnId', v_pawn->>'id',
        'fromTileId', private.ludo_path_index_to_tile_id(p_color, null),
        'toTileId', private.ludo_path_index_to_tile_id(p_color, 0),
        'capturesPawnIds', v_captures,
        'finishesPawn', false
      );
      continue;
    end if;

    if v_state = 'finished' then
      continue;
    end if;

    v_path_index := (v_pawn->>'pathIndex')::int;
    v_target := v_path_index + p_die_value;
    -- Only a piece still on the shared track is held back. One already in
    -- the home column has passed that point and carries on.
    if v_held_back and v_path_index <= 50 and v_target > 50 then
      v_target := 50; -- stops at the last shared square
    end if;
    if v_target > 56 then
      continue; -- overshoot — illegal, excluded (not "moved and bounced")
    end if;
    if v_target = v_path_index then
      continue; -- held back with nowhere to go
    end if;

    if v_target <= 50 then
      v_captures := private.ludo_captures_at(p_pawns, p_color, v_target);
    else
      v_captures := '[]'::jsonb;
    end if;

    v_moves := v_moves || jsonb_build_object(
      'pawnId', v_pawn->>'id',
      'fromTileId', private.ludo_path_index_to_tile_id(p_color, v_path_index),
      'toTileId', private.ludo_path_index_to_tile_id(p_color, v_target),
      'capturesPawnIds', v_captures,
      'finishesPawn', (v_target = 56)
    );
  end loop;

  return v_moves;
end;
$function$;
revoke execute on function private.ludo_legal_moves(jsonb, text, integer, jsonb, boolean) from public;
