-- Two Snakes & Ladders rule fixes:
-- 1. A piece needs a six to leave the nest, same as Ludo's home-exit rule
--    (previously any roll entered the board).
-- 2. A 2-player match ends the instant the first player reaches 100,
--    instead of waiting for a second place that can't exist. Mirrors the
--    fix already shipped client-side for Practice/Table Together in
--    lib/presentation/practice.ts's snakePracticeReducer.
create or replace function private.snakes_move(p_pawns jsonb, p_color text, p_die int)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_pawn jsonb; v_landing int; v_destination int;
begin
  if p_die is null or p_die not between 1 and 6 then return null; end if;
  select p into v_pawn from jsonb_array_elements(p_pawns) p
    where p->>'color' = p_color and p->>'state' <> 'finished' limit 1;
  if v_pawn is null then return null; end if;
  if (v_pawn->>'pathIndex') is null and p_die <> 6 then return null; end if;
  v_landing := coalesce((v_pawn->>'pathIndex')::int, 0) + p_die;
  if v_landing > 100 then return null; end if;
  v_destination := case v_landing
    when 4 then 16 when 9 then 30 when 18 then 44 when 28 then 54 when 50 then 73 when 71 then 91
    when 14 then 6 when 59 then 40 when 87 then 45 when 93 then 72 when 95 then 75 when 98 then 38
    else v_landing end;
  return jsonb_build_object(
    'pawnId', v_pawn->>'id',
    'fromTileId', case when v_pawn->>'pathIndex' is null then null else 'snakes:' || (v_pawn->>'pathIndex') end,
    'toTileId', 'snakes:' || v_destination,
    'capturesPawnIds', '[]'::jsonb,
    'finishesPawn', v_destination = 100,
    'landingSquare', v_landing
  );
end;
$$;
revoke execute on function private.snakes_move(jsonb, text, int) from public;

create or replace function private.snakes_apply_roll(p_room_id uuid, p_player_id uuid, p_die int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms; v_color text; v_pawns jsonb; v_move jsonb; v_destination int;
  v_winners uuid[]; v_count int; v_complete boolean := false; v_still_in_nest boolean;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if v_room.game_type <> 'snakes_and_ladders' or v_room.status <> 'in_game'
    or v_room.turn_phase <> 'awaiting_roll' then raise exception 'INVALID_PHASE'; end if;
  if p_player_id is distinct from v_room.turn_player_id then raise exception 'NOT_YOUR_TURN'; end if;
  if p_die is null or p_die not between 1 and 6 then raise exception 'INVALID_DIE'; end if;
  select color into v_color from public.players where id = p_player_id;
  v_pawns := private.ludo_room_pawns_json(p_room_id);
  select (p->>'pathIndex') is null into v_still_in_nest
    from jsonb_array_elements(v_pawns) p
    where p->>'color' = v_color and p->>'state' <> 'finished' limit 1;
  v_move := private.snakes_move(v_pawns, v_color, p_die);
  perform private.ludo_append_event(p_room_id, 'dice_rolled', p_player_id,
    jsonb_build_object(
      'dieValue', p_die,
      'cancelledByThirdSix', false,
      'overshoot', v_move is null and not v_still_in_nest,
      'needsSixToEnter', v_move is null and v_still_in_nest
    ));
  if v_move is not null then
    v_destination := split_part(v_move->>'toTileId', ':', 2)::int;
    update public.pawns set path_index = v_destination,
      state = case when v_destination = 100 then 'finished' else 'track' end
      where id = (v_move->>'pawnId')::uuid;
    perform private.ludo_append_event(p_room_id, 'legal_move_selected', p_player_id, v_move);
    if v_destination = 100 then
      v_winners := array_append(v_room.winner_ids, p_player_id);
      select count(*) into v_count from public.players where room_id = p_room_id;
      v_complete := (v_count = 2 and cardinality(v_winners) >= 1) or cardinality(v_winners) = v_count;
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
