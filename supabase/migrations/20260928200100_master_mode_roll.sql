-- Master mode, second half: the roll itself has to know the rules too, or a
-- player held back from their home column could be told they have a move
-- when they have none.
--
-- 20260928200000_master_mode.sql added the arguments but left the original
-- three-argument function in place, which made an ordinary three-argument
-- call ambiguous. The new one's defaults cover those callers, so the old
-- signature goes.

-- Redefines the live version: a roll's moves follow the match's rules.
CREATE OR REPLACE FUNCTION private.ludo_perform_ludo_roll(p_room_id uuid, p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_die_value int;
  v_six_eval jsonb;
  v_mover_color text;
  v_legal_moves jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;

  v_die_value := private.roll_match_die(p_room_id);
  v_six_eval := private.ludo_evaluate_six_roll(v_room.consecutive_sixes, v_die_value);

  perform private.ludo_append_event(p_room_id, 'dice_rolled', p_player_id, jsonb_build_object(
    'dieValue', v_die_value,
    'cancelledByThirdSix', v_six_eval->'cancelMove'
  ));

  if (v_six_eval->>'cancelMove')::boolean then
    -- Third consecutive six: this roll's move is cancelled, turn ends now.
    perform private.ludo_advance_to_next_player(p_room_id);
    perform private.ludo_broadcast_state(p_room_id);
    return jsonb_build_object('dieValue', v_die_value, 'legalMoves', '[]'::jsonb, 'cancelledByThirdSix', true);
  end if;

  select color into v_mover_color from public.players where id = p_player_id;
  v_legal_moves := private.ludo_legal_moves(private.ludo_room_pawns_json(p_room_id), v_mover_color, v_die_value,
    (select match_rules from public.rooms where id = p_room_id),
    (select has_captured from public.players where id = p_player_id));

  if jsonb_array_length(v_legal_moves) = 0 then
    -- No-move turn (PRD 4.2): the server advances immediately; the client's
    -- 1.5s "no move" acknowledgement is purely a display-pacing concern.
    update public.rooms set consecutive_sixes = (v_six_eval->>'consecutiveSixesAfter')::int where id = p_room_id;
    perform private.ludo_advance_to_next_player(p_room_id);
  else
    update public.rooms
    set active_dice_value = v_die_value,
        turn_phase = 'awaiting_move',
        turn_deadline_at = private.ludo_next_turn_deadline(p_player_id),
        rolls_this_turn = rolls_this_turn + 1,
        consecutive_sixes = (v_six_eval->>'consecutiveSixesAfter')::int
    where id = p_room_id;
  end if;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('dieValue', v_die_value, 'legalMoves', v_legal_moves, 'cancelledByThirdSix', false);
end;
$function$;

drop function if exists private.ludo_legal_moves(jsonb, text, integer);
