-- In Snakes & Ladders, a six grants another roll unless that roll finishes
-- the player's piece. Finished players are skipped as usual.
create or replace function private.snakes_apply_roll(p_room_id uuid, p_player_id uuid, p_die int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms; v_color text; v_move jsonb; v_destination int;
  v_winners uuid[]; v_count int; v_complete boolean := false;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.game_type <> 'snakes_and_ladders' or v_room.status <> 'in_game'
    or v_room.turn_phase <> 'awaiting_roll' then raise exception 'INVALID_PHASE'; end if;
  if p_player_id is distinct from v_room.turn_player_id then raise exception 'NOT_YOUR_TURN'; end if;
  if p_die is null or p_die not between 1 and 6 then raise exception 'INVALID_DIE'; end if;
  select color into v_color from public.players where id = p_player_id;
  v_move := private.snakes_move(private.ludo_room_pawns_json(p_room_id), v_color, p_die);
  perform private.ludo_append_event(p_room_id, 'dice_rolled', p_player_id,
    jsonb_build_object('dieValue', p_die, 'cancelledByThirdSix', false, 'overshoot', v_move is null));
  if v_move is not null then
    v_destination := split_part(v_move->>'toTileId', ':', 2)::int;
    update public.pawns set path_index = v_destination,
      state = case when v_destination = 100 then 'finished' else 'track' end
      where id = (v_move->>'pawnId')::uuid;
    perform private.ludo_append_event(p_room_id, 'legal_move_selected', p_player_id, v_move);
    if v_destination = 100 then
      v_winners := array_append(v_room.winner_ids, p_player_id);
      select count(*) into v_count from public.players where room_id = p_room_id;
      v_complete := cardinality(v_winners) = v_count;
      update public.rooms set winner_ids = v_winners where id = p_room_id;
      perform private.ludo_append_event(p_room_id, 'player_finished', p_player_id,
        jsonb_build_object('place', cardinality(v_winners)));
      if v_complete then
        update public.rooms set status = 'summary', turn_phase = 'complete',
          turn_player_id = null, turn_deadline_at = null, active_dice_value = null,
          match_end_reason = 'completed' where id = p_room_id;
        perform private.ludo_append_event(p_room_id, 'match_completed', v_winners[1],
          jsonb_build_object('winnerId', v_winners[1], 'placements', v_winners));
      end if;
    end if;
  end if;
  if not v_complete then
    if p_die = 6 and v_destination is distinct from 100 then
      update public.rooms set
        turn_phase = 'awaiting_roll',
        turn_deadline_at = private.ludo_next_turn_deadline(p_player_id),
        active_dice_value = null,
        rolls_this_turn = rolls_this_turn + 1
      where id = p_room_id;
    else
      perform private.ludo_advance_to_next_player(p_room_id);
    end if;
  end if;
  perform private.ludo_broadcast_state(p_room_id);
  return jsonb_build_object('dieValue', p_die, 'legalMoves', '[]'::jsonb, 'cancelledByThirdSix', false);
end;
$$;
revoke execute on function private.snakes_apply_roll(uuid, uuid, int) from public;
