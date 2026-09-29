-- Master mode (docs/COMPETITIVE_ROADMAP.md F2.2): a piece may only go into
-- its home column once its player has captured someone. Until then a piece
-- that would pass the last shared square stops there instead — the move is
-- still legal, it just stops short.
--
-- `captureToEnterHome` is an ordinary room rule (F0.2) like the rest, so the
-- house rules panel can combine it later (F2.4). Off by default: the classic
-- game is unchanged.

alter table public.players add column has_captured boolean not null default false;

create or replace function private.ludo_default_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4, "captureToEnterHome": false}'::jsonb;
$$;

-- Redefines the live version: two optional arguments say which rules are in
-- play and whether this player has captured yet. Callers that pass neither
-- get the classic game, exactly as before.
create or replace function private.ludo_legal_moves(
  p_pawns jsonb,
  p_color text,
  p_die_value integer,
  p_rules jsonb default null,
  p_has_captured boolean default false
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
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
    if v_held_back and v_target > 50 then
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
$$;
revoke execute on function private.ludo_legal_moves(jsonb, text, integer, jsonb, boolean) from public;

-- Redefines the live version: the mover's own rules decide their moves, and
-- a first capture is recorded.
CREATE OR REPLACE FUNCTION private.ludo_perform_move(p_room_id uuid, p_player_id uuid, p_pawn_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_legal_moves := private.ludo_legal_moves(v_pawns_json, v_mover_color, v_room.active_dice_value,
    v_room.match_rules, (select has_captured from public.players where id = p_player_id));

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

  if jsonb_array_length(coalesce(v_move->'capturesPawnIds', '[]'::jsonb)) > 0 then
    update public.players set has_captured = true where id = p_player_id and not has_captured;
  end if;
  perform private.ludo_append_event(p_room_id, 'legal_move_selected', p_player_id, v_move);
  v_won := private.ludo_is_match_won(v_new_pawns, v_mover_color, v_room.match_rules);

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

    if (v_player_count = 2 and coalesce(array_length(v_winner_ids, 1), 0) >= 1)
      or coalesce(array_length(v_winner_ids, 1), 0) >= v_player_count then
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
    v_bonus := private.ludo_earns_bonus_roll(v_room.active_dice_value, v_move, v_room.match_rules);
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
$function$;

-- Redefines the live version: a computer taking over plays by the same rules.
CREATE OR REPLACE FUNCTION private.ludo_resolve_turn_timeout(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_player public.players;
  v_is_bot_controlled boolean;
  v_new_miss_count int;
  v_pawns_json jsonb;
  v_legal_moves jsonb;
  v_chosen_move jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.turn_player_id is null then
    return;
  end if;

  select * into v_player from public.players where id = v_room.turn_player_id;
  v_is_bot_controlled := v_player.is_bot or v_player.status = 'bot' or v_player.auto_roll_enabled;

  if not v_is_bot_controlled then
    -- A genuine miss: count it, and escalate on the documented thresholds
    -- (PRD 5.2). "OR a continuous disconnect longer than 45 seconds" is
    -- evaluated here, on top of the miss itself — see the file header for
    -- why this can only fire on an already-missed decision, not ambiently.
    update public.players
    set missed_decision_count = missed_decision_count + 1
    where id = v_player.id
    returning missed_decision_count into v_new_miss_count;

    perform private.ludo_append_event(p_room_id, 'decision_timed_out', v_player.id, jsonb_build_object(
      'phase', v_room.turn_phase,
      'missedDecisions', v_new_miss_count
    ));

    if v_new_miss_count = 2 then
      update public.players set status = 'inactive' where id = v_player.id;
    end if;

    if v_new_miss_count >= 3 or (now() - v_player.last_seen_at) > interval '45 seconds' then
      update public.players set status = 'bot' where id = v_player.id;
      v_is_bot_controlled := true;
    end if;
  end if;

  if v_room.turn_phase = 'awaiting_roll' then
    perform private.ludo_perform_roll(p_room_id, v_room.turn_player_id);
  elsif v_room.turn_phase = 'awaiting_move' then
    v_pawns_json := private.ludo_room_pawns_json(p_room_id);
    v_legal_moves := private.ludo_legal_moves(v_pawns_json, v_player.color, v_room.active_dice_value,
      v_room.match_rules, v_player.has_captured);
    v_chosen_move := private.ludo_choose_bot_move(v_legal_moves, v_pawns_json);

    if v_chosen_move is null then
      -- Defensive only: awaiting_move implies legal_moves was non-empty
      -- when the roll was made. Advance rather than leave the room stuck.
      perform private.ludo_advance_to_next_player(p_room_id);
    else
      perform private.ludo_perform_move(p_room_id, v_room.turn_player_id, (v_chosen_move->>'pawnId')::uuid);
    end if;
  end if;
  -- Any other turn_phase ('resolving', 'complete') has nothing to time out —
  -- those are resolved synchronously within a single transaction elsewhere.
end;
$function$;

-- Redefines the live version: the turn player's legal moves follow the
-- match's rules, and every seat says whether it has captured yet.
CREATE OR REPLACE FUNCTION private.ludo_room_state_json(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'roomId', r.id, 'hostPlayerId', r.host_player_id, 'code', r.code, 'gameType', r.game_type,
    'status', r.status, 'paused', r.paused_at is not null, 'maxPlayers', r.max_players,
    'pausedForPlayerId', r.paused_for_player_id, 'pausedAt', r.paused_at,
    'rules', private.ludo_resolve_rules(r.rules),
    'matchId', r.current_match_id,
    'isParty', r.is_party, 'partyLocked', r.party_locked, 'partyTurnSeconds', r.party_turn_seconds,
    'diceCommitment', (select m.dice_commitment from public.matches m where m.id = r.current_match_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name, 'color', p.color,
      'status', p.status, 'isBot', p.is_bot, 'missedDecisionCount', p.missed_decision_count,
      'level', p.level, 'testWalletBalance', p.test_wallet_balance, 'autoRollEnabled', p.auto_roll_enabled,
      'rematchReady', p.rematch_ready, 'inVoice', p.in_voice, 'partyRemote', p.party_remote,
      'hasCaptured', p.has_captured,
      'avatarId', coalesce((select u.raw_user_meta_data ->> 'avatar_id' from auth.users u where u.id = p.user_id), (array['fox','panda','owl','frog'])[p.seat_index + 1]),
      'country', coalesce((select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id), '')
    ) order by p.seat_index) from public.players p where p.room_id = r.id), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id), 'turnPlayerId', r.turn_player_id,
    'turnPhase', r.turn_phase, 'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value, 'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null then private.ludo_legal_moves(private.ludo_room_pawns_json(r.id), (select color from public.players where id = r.turn_player_id), r.active_dice_value, r.match_rules, (select has_captured from public.players where id = r.turn_player_id)) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb), 'matchEndReason', r.match_end_reason,
    'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$function$;
revoke execute on function private.ludo_room_state_json(uuid) from public;
