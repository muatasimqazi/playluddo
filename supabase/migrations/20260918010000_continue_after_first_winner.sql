-- Keep the match running after the first player finishes. winner_ids is an
-- ordered placement list, and completed colors are skipped in turn rotation.

create or replace function private.ludo_advance_to_next_player(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_current_seat int;
  v_next_player_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id;

  select seat_index into v_current_seat
  from public.players
  where room_id = p_room_id and id = v_room.turn_player_id;

  select id into v_next_player_id
  from public.players
  where room_id = p_room_id
    and not (id = any(v_room.winner_ids))
  order by
    case when seat_index > coalesce(v_current_seat, -1) then 0 else 1 end,
    seat_index
  limit 1;

  update public.rooms
  set turn_player_id = v_next_player_id,
      turn_phase = 'awaiting_roll',
      turn_deadline_at = private.ludo_next_turn_deadline(v_next_player_id),
      active_dice_value = null,
      consecutive_sixes = 0,
      rolls_this_turn = 0
  where id = p_room_id;
end;
$$;

revoke execute on function private.ludo_advance_to_next_player(uuid) from public;

create or replace function private.ludo_perform_move(p_room_id uuid, p_player_id uuid, p_pawn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_mover_color text;
  v_pawns_json jsonb;
  v_legal_moves jsonb;
  v_move jsonb;
  v_new_pawns jsonb;
  v_pawn jsonb;
  v_won boolean;
  v_bonus boolean;
  v_winner_ids uuid[];
  v_player_count int;
begin
  select * into v_room from public.rooms where id = p_room_id;
  select color into v_mover_color from public.players where id = p_player_id;

  v_pawns_json := private.ludo_room_pawns_json(p_room_id);
  v_legal_moves := private.ludo_legal_moves(v_pawns_json, v_mover_color, v_room.active_dice_value);

  select move into v_move
  from jsonb_array_elements(v_legal_moves) as move
  where (move->>'pawnId')::uuid = p_pawn_id;

  if v_move is null then
    raise exception 'ILLEGAL_MOVE';
  end if;

  v_new_pawns := private.ludo_apply_move(v_pawns_json, v_move);

  for v_pawn in select * from jsonb_array_elements(v_new_pawns)
  loop
    update public.pawns
    set state = v_pawn->>'state',
        path_index = (v_pawn->>'pathIndex')::int
    where id = (v_pawn->>'id')::uuid;
  end loop;

  perform private.ludo_append_event(p_room_id, 'legal_move_selected', p_player_id, v_move);
  v_won := private.ludo_is_match_won(v_new_pawns, v_mover_color);

  if v_won then
    v_winner_ids := case
      when p_player_id = any(v_room.winner_ids) then v_room.winner_ids
      else array_append(v_room.winner_ids, p_player_id)
    end;
    select count(*) into v_player_count from public.players where room_id = p_room_id;

    perform private.ludo_append_event(
      p_room_id,
      'player_finished',
      p_player_id,
      jsonb_build_object('place', array_length(v_winner_ids, 1))
    );

    if coalesce(array_length(v_winner_ids, 1), 0) >= v_player_count then
      update public.rooms
      set status = 'summary',
          winner_ids = v_winner_ids,
          match_end_reason = 'completed',
          turn_phase = 'complete',
          turn_deadline_at = null,
          active_dice_value = null
      where id = p_room_id;

      perform private.ludo_append_event(
        p_room_id,
        'match_completed',
        v_winner_ids[1],
        jsonb_build_object('winnerId', v_winner_ids[1], 'placements', v_winner_ids)
      );
    else
      update public.rooms set winner_ids = v_winner_ids where id = p_room_id;
      perform private.ludo_advance_to_next_player(p_room_id);
    end if;
  else
    v_bonus := private.ludo_earns_bonus_roll(v_room.active_dice_value, v_move);
    if v_bonus then
      update public.rooms
      set turn_phase = 'awaiting_roll',
          turn_deadline_at = private.ludo_next_turn_deadline(p_player_id),
          active_dice_value = null
      where id = p_room_id;
    else
      perform private.ludo_advance_to_next_player(p_room_id);
    end if;
  end if;

  perform private.ludo_broadcast_state(p_room_id);
  return jsonb_build_object('move', v_move, 'won', v_won);
end;
$$;

revoke execute on function private.ludo_perform_move(uuid, uuid, uuid) from public;
