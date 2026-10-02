-- The turn's dice are used strictly in order (docs/PRD.md 4.2, changed
-- 2026-10-02).
--
-- 20261001150000_roll_sixes_first.sql passed over a die that couldn't move
-- anything. That let a six nobody could use buy a free roll: with the last
-- piece in its home lane, roll a 6 (unusable), roll again until the exact
-- number comes up, and move by that alone. Now each die is used before the
-- next one: a die with no legal move ends the moving, and the dice after it
-- are lost. An extra roll already earned by a capture or a piece home that
-- turn is still taken.
--
-- And a six earns the roll after it only if it can be moved by. The first six
-- of a run is checked against the board as it stands; with nothing able to
-- move six, the turn ends on that roll. Later sixes wait for the moves before
-- them, so ludo_next_playable_die settles them.
--
-- Mirrored by lib/board/rules.ts (nextPlayableDie, sixRollsAgain) and the
-- offline engine in lib/presentation/practice.ts; tests/parity holds them
-- together.

-- Redefines 20261001150000_roll_sixes_first.sql: only the next die counts.
create or replace function private.ludo_next_playable_die(
  p_pawns jsonb, p_color text, p_dice integer[],
  p_rules jsonb default null, p_has_captured boolean default false
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_moves jsonb;
begin
  if coalesce(array_length(p_dice, 1), 0) = 0 then
    return null;
  end if;
  v_moves := private.ludo_legal_moves(p_pawns, p_color, p_dice[1], p_rules, p_has_captured);
  if jsonb_array_length(v_moves) = 0 then
    return null;
  end if;
  return jsonb_build_object(
    'dieValue', p_dice[1],
    'rest', to_jsonb(coalesce(p_dice[2:], '{}'::integer[])),
    'legalMoves', v_moves
  );
end;
$$;

-- Redefines 20261001150000_roll_sixes_first.sql: a six that can't move ends
-- the turn instead of rolling again.
create or replace function private.ludo_perform_ludo_roll(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_player public.players;
  v_die_value int;
  v_six_eval jsonb;
  v_sixes integer[];
  v_legal_moves jsonb := '[]'::jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;
  select * into v_player from public.players where id = p_player_id;

  v_die_value := private.roll_match_die(p_room_id);
  v_six_eval := private.ludo_evaluate_six_roll(v_room.consecutive_sixes, v_die_value);
  -- The sixes already rolled this turn. Without a streak there are none,
  -- whatever an earlier match or turn left in the column.
  v_sixes := case when v_room.consecutive_sixes > 0 then v_room.pending_dice else '{}'::integer[] end;

  perform private.ludo_append_event(p_room_id, 'dice_rolled', p_player_id, jsonb_build_object(
    'dieValue', v_die_value,
    'cancelledByThirdSix', v_six_eval->'cancelMove'
  ));

  if (v_six_eval->>'cancelMove')::boolean then
    -- Third consecutive six: all three count for nothing, the turn ends now.
    perform private.ludo_advance_to_next_player(p_room_id);
    perform private.ludo_broadcast_state(p_room_id);
    return jsonb_build_object('dieValue', v_die_value, 'legalMoves', '[]'::jsonb, 'cancelledByThirdSix', true);
  end if;

  if v_die_value = 6 and (
    cardinality(v_sixes) > 0
    or jsonb_array_length(private.ludo_legal_moves(private.ludo_room_pawns_json(p_room_id),
      v_player.color, 6, v_room.match_rules, v_player.has_captured)) > 0
  ) then
    -- Roll again before moving; the six waits its turn.
    update public.rooms
    set pending_dice = v_sixes || v_die_value,
        consecutive_sixes = (v_six_eval->>'consecutiveSixesAfter')::int,
        rolls_this_turn = rolls_this_turn + 1,
        active_dice_value = null,
        turn_phase = 'awaiting_roll',
        turn_deadline_at = private.ludo_next_turn_deadline(p_player_id)
    where id = p_room_id;
  else
    -- The rolling is over: move by each die in the order rolled. A six
    -- nothing can move lands here too, and ends the turn.
    update public.rooms
    set pending_dice = v_sixes || v_die_value,
        consecutive_sixes = 0,
        rolls_this_turn = rolls_this_turn + 1,
        bonus_roll_pending = false
    where id = p_room_id;
    perform private.ludo_play_next_die(p_room_id, p_player_id);

    select * into v_room from public.rooms where id = p_room_id;
    if v_room.turn_phase = 'awaiting_move' and v_room.turn_player_id = p_player_id then
      v_legal_moves := private.ludo_legal_moves(private.ludo_room_pawns_json(p_room_id),
        v_player.color, v_room.active_dice_value, v_room.match_rules,
        (select has_captured from public.players where id = p_player_id));
    end if;
  end if;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('dieValue', v_die_value, 'legalMoves', v_legal_moves, 'cancelledByThirdSix', false);
end;
$$;
