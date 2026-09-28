-- Unbiased dice (docs/COMPETITIVE_ROADMAP.md F0.1). Online Ludo rolled with
-- `1 + random_byte % 6`: 256 isn't a multiple of 6, so faces 1-4 came up
-- with probability 43/256 and faces 5-6 with 42/256. Every roll now goes
-- through private.roll_die(), which discards bytes 252-255 and redraws, so
-- the 252 accepted bytes map to exactly 42 per face. Snakes & Ladders
-- already did this inline; it now shares the same function.

-- The byte-to-face mapping, split out so tests can check all 256 inputs
-- deterministically. Null means "rejected, draw again".
create or replace function private.die_face_from_byte(p_byte int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_byte between 0 and 251 then 1 + p_byte % 6 end;
$$;

revoke execute on function private.die_face_from_byte(int) from public;

-- Server-side CSPRNG (docs/PRD.md Section 6.2) — never client-supplied.
create or replace function private.roll_die()
returns int
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_face int;
begin
  loop
    v_face := private.die_face_from_byte(get_byte(extensions.gen_random_bytes(1), 0));
    exit when v_face is not null;
  end loop;
  return v_face;
end;
$$;

revoke execute on function private.roll_die() from public;

-- Redefines 20260918020000_snakes_and_ladders.sql's version; only the roll
-- line changes.
create or replace function private.ludo_perform_ludo_roll(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_die_value int;
  v_six_eval jsonb;
  v_mover_color text;
  v_legal_moves jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;

  v_die_value := private.roll_die();
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
  v_legal_moves := private.ludo_legal_moves(private.ludo_room_pawns_json(p_room_id), v_mover_color, v_die_value);

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
$$;

revoke execute on function private.ludo_perform_ludo_roll(uuid, uuid) from public;

-- Redefines 20260918020000_snakes_and_ladders.sql's version: Snakes &
-- Ladders rolls use the shared function instead of their own loop.
create or replace function private.ludo_perform_roll(p_room_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.status <> 'in_game' then raise exception 'INVALID_PHASE'; end if;
  if v_room.game_type = 'ludo' then
    return private.ludo_perform_ludo_roll(p_room_id, p_player_id);
  end if;
  return private.snakes_apply_roll(p_room_id, p_player_id, private.roll_die());
end;
$$;
revoke execute on function private.ludo_perform_roll(uuid, uuid) from public;
