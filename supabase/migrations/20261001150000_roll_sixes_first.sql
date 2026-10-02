-- Sixes are rolled first (docs/PRD.md 4.2, changed 2026-10-01).
--
-- Until now a six was moved straight away and then earned another roll.
-- Now a six is rolled again at once, before anything moves; the first roll
-- that isn't a six ends the rolling, and the player then moves by each of
-- the turn's dice in the order they came up. A die that can't move anything
-- is passed over. Three sixes in a row count for nothing: none of them is
-- moved and the turn passes.
--
-- A capture, or a piece getting home while bonusRollOnFinish is on, still
-- earns one more roll, now taken once the turn's dice are used up. Never
-- stacked: however many of those moves qualify, it is one roll.
--
-- Two room columns carry the turn's dice:
-- * pending_dice: while awaiting a roll, the sixes rolled so far; while
--   awaiting a move, the dice still to come after active_dice_value. It is
--   only trusted alongside a six streak or a move in hand, so a value left
--   over from an earlier match (or a room mid-turn when this shipped) is
--   never moved by.
-- * bonus_roll_pending: a move among this turn's dice earned another roll.
--   Reset whenever a fresh set of dice starts being moved.
--
-- Mirrored by lib/board/rules.ts (nextPlayableDie, earnsBonusRoll) and the
-- offline engine in lib/presentation/practice.ts; tests/parity holds them
-- together.

alter table public.rooms
  add column pending_dice integer[] not null default '{}',
  add column bonus_roll_pending boolean not null default false;

-- A move's own extra roll: a capture, or a piece home when the rule is on.
-- The die no longer matters — a six's extra roll is taken before it moves.
drop function private.ludo_earns_bonus_roll(integer, jsonb, jsonb);
create function private.ludo_earns_bonus_roll(p_move jsonb, p_rules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_array_length(coalesce(p_move->'capturesPawnIds', '[]'::jsonb)) > 0
    or (
      (private.ludo_resolve_rules(p_rules)->>'bonusRollOnFinish')::boolean
      and coalesce((p_move->>'finishesPawn')::boolean, false)
    );
$$;
revoke execute on function private.ludo_earns_bonus_roll(jsonb, jsonb) from public;

-- The next of the turn's dice that moves anything, in the order rolled:
-- {dieValue, rest, legalMoves}, or null when none of them can.
create function private.ludo_next_playable_die(
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
  for i in 1..coalesce(array_length(p_dice, 1), 0) loop
    v_moves := private.ludo_legal_moves(p_pawns, p_color, p_dice[i], p_rules, p_has_captured);
    if jsonb_array_length(v_moves) > 0 then
      return jsonb_build_object(
        'dieValue', p_dice[i],
        'rest', to_jsonb(coalesce(p_dice[i + 1:], '{}'::integer[])),
        'legalMoves', v_moves
      );
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function private.ludo_next_playable_die(jsonb, text, integer[], jsonb, boolean) from public;

-- Puts the next playable die in the player's hand. With none left, the turn
-- takes the extra roll a capture or a piece home earned, or passes on.
-- Expects pending_dice to hold the dice still to move by.
create function private.ludo_play_next_die(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_player public.players;
  v_next jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;
  select * into v_player from public.players where id = p_player_id;
  v_next := private.ludo_next_playable_die(private.ludo_room_pawns_json(p_room_id), v_player.color,
    v_room.pending_dice, v_room.match_rules, v_player.has_captured);

  if v_next is not null then
    update public.rooms
    set active_dice_value = (v_next->>'dieValue')::int,
        pending_dice = array(select jsonb_array_elements_text(v_next->'rest')::int),
        turn_phase = 'awaiting_move',
        turn_deadline_at = private.ludo_next_turn_deadline(p_player_id)
    where id = p_room_id;
  elsif v_room.bonus_roll_pending then
    update public.rooms
    set active_dice_value = null,
        pending_dice = '{}',
        bonus_roll_pending = false,
        turn_phase = 'awaiting_roll',
        turn_deadline_at = private.ludo_next_turn_deadline(p_player_id)
    where id = p_room_id;
  else
    -- No-move turn (PRD 4.2): the server advances immediately; the client's
    -- 1.5s "no move" acknowledgement is purely a display-pacing concern.
    perform private.ludo_advance_to_next_player(p_room_id);
  end if;
end;
$$;
revoke execute on function private.ludo_play_next_die(uuid, uuid) from public;

-- Redefines 20260928200100_master_mode_roll.sql: a six is rolled again
-- before anything moves.
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
  v_sixes integer[];
  v_legal_moves jsonb := '[]'::jsonb;
begin
  select * into v_room from public.rooms where id = p_room_id;

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

  if v_die_value = 6 then
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
    -- The rolling is over: move by each die in the order rolled.
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
        (select color from public.players where id = p_player_id), v_room.active_dice_value,
        v_room.match_rules, (select has_captured from public.players where id = p_player_id));
    end if;
  end if;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('dieValue', v_die_value, 'legalMoves', v_legal_moves, 'cancelledByThirdSix', false);
end;
$$;

-- Redefines 20260929010300_team_up_results.sql: after a move, the next of
-- the turn's dice comes up; the extra roll for a capture or a piece home
-- waits until they're used.
create or replace function private.ludo_perform_move(p_room_id uuid,p_player_id uuid,p_pawn_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_actor_color text;
  v_owner_color text;
  v_team boolean;
  v_before jsonb;
  v_legal jsonb;
  v_move jsonb;
  v_after jsonb;
  v_pawn jsonb;
  v_finished boolean;
  v_won boolean;
  v_winners uuid[];
  v_player_count int;
  v_winning_side smallint;
  v_owner_id uuid;
begin
  select * into v_room from public.rooms where id=p_room_id;
  select color into v_actor_color from public.players where id=p_player_id and room_id=p_room_id;
  v_team := coalesce((private.ludo_resolve_rules(v_room.match_rules)->>'teamUp')::boolean,false);
  v_before := private.ludo_room_pawns_json(p_room_id);
  v_legal := private.ludo_legal_moves(v_before,v_actor_color,v_room.active_dice_value,
    v_room.match_rules,(select has_captured from public.players where id=p_player_id));
  select value into v_move from jsonb_array_elements(v_legal)
    where (value->>'pawnId')::uuid=p_pawn_id;
  if v_move is null then raise exception 'ILLEGAL_MOVE'; end if;
  select color,player_id into v_owner_color,v_owner_id
    from public.pawns pw join public.players pl on pl.id=pw.player_id
    where pw.id=p_pawn_id and pw.room_id=p_room_id;
  v_after := private.ludo_apply_move(v_before,v_move);
  for v_pawn in select value from jsonb_array_elements(v_after) loop
    update public.pawns set state=v_pawn->>'state',path_index=(v_pawn->>'pathIndex')::int
      where id=(v_pawn->>'id')::uuid;
  end loop;
  if jsonb_array_length(coalesce(v_move->'capturesPawnIds','[]'::jsonb))>0 then
    update public.players set has_captured=true where id=p_player_id and not has_captured;
  end if;
  perform private.ludo_append_event(p_room_id,'legal_move_selected',p_player_id,
    v_move || jsonb_build_object('pawnOwnerId',v_owner_id));

  v_finished := private.ludo_is_match_won(v_after,v_owner_color,v_room.match_rules);
  if v_team then
    -- Finishing the actor's own four only unlocks partner control.  The
    -- result is decided by the two colors together, never by pawnsToWin.
    if v_finished and not private.ludo_is_match_won(v_before,v_owner_color,v_room.match_rules) then
      perform private.ludo_append_event(p_room_id,'player_finished',v_owner_id,
        jsonb_build_object('side',(select side from public.players where id=v_owner_id)));
    end if;
    v_won := private.ludo_team_up_won(v_after,v_owner_color);
    if v_won then
      select side into v_winning_side from public.players where id=v_owner_id;
      select array_agg(id order by case when side=v_winning_side then 0 else 1 end,seat_index)
        into v_winners from public.players where room_id=p_room_id;
      update public.rooms set status='summary',winner_ids=v_winners,
        match_end_reason='completed',turn_phase='complete',turn_deadline_at=null,
        turn_player_id=null,active_dice_value=null where id=p_room_id;
      perform private.ludo_append_event(p_room_id,'match_completed',p_player_id,
        jsonb_build_object('winnerId',v_winners[1],'winningSide',v_winning_side,
          'winningPlayerIds',to_jsonb(v_winners[1:2]),'placements',to_jsonb(v_winners)));
    end if;
  else
    v_won := v_finished;
    if v_won then
      v_winners := case when p_player_id=any(v_room.winner_ids) then v_room.winner_ids
        else array_append(v_room.winner_ids,p_player_id) end;
      select count(*) into v_player_count from public.players where room_id=p_room_id;
      perform private.ludo_append_event(p_room_id,'player_finished',p_player_id,
        jsonb_build_object('place',array_length(v_winners,1)));
      if (v_player_count=2 and coalesce(array_length(v_winners,1),0)>=1)
        or coalesce(array_length(v_winners,1),0)>=v_player_count then
        update public.rooms set status='summary',winner_ids=v_winners,
          match_end_reason='completed',turn_phase='complete',turn_deadline_at=null,
          active_dice_value=null where id=p_room_id;
        perform private.ludo_append_event(p_room_id,'match_completed',v_winners[1],
          jsonb_build_object('winnerId',v_winners[1],'placements',v_winners));
      else
        update public.rooms set winner_ids=v_winners where id=p_room_id;
        perform private.ludo_advance_to_next_player(p_room_id);
      end if;
    end if;
  end if;

  if not v_won and (v_team or not v_finished) then
    if private.ludo_earns_bonus_roll(v_move,v_room.match_rules) then
      update public.rooms set bonus_roll_pending=true where id=p_room_id;
    end if;
    perform private.ludo_play_next_die(p_room_id,p_player_id);
  end if;
  perform private.ludo_broadcast_state(p_room_id);
  return jsonb_build_object('move',v_move,'won',v_won);
end;
$$;

-- Redefines 20260928220000_rush_mode.sql: a new turn starts with no dice.
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

  -- Rush mode (F2.3): the clock ran out during that turn, so the turn
  -- finished and the match ends here rather than mid-move.
  if v_room.match_ends_at is not null and v_room.status = 'in_game' and now() >= v_room.match_ends_at then
    perform private.ludo_end_match_on_time(p_room_id);
    return;
  end if;

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
      rolls_this_turn = 0,
      pending_dice = '{}',
      bonus_roll_pending = false
  where id = p_room_id;
end;
$$;

-- Redefines 20260930120000_video_calls.sql: the snapshot carries the turn's
-- dice (pendingDice) and whether an extra roll is owed (bonusRollPending).
create or replace function private.ludo_room_state_json(p_room_id uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'roomId', r.id, 'hostPlayerId', r.host_player_id, 'code', r.code, 'gameType', r.game_type,
    'status', r.status, 'paused', r.paused_at is not null, 'maxPlayers', r.max_players,
    'pausedForPlayerId', r.paused_for_player_id, 'pausedAt', r.paused_at,
    'rules', private.ludo_resolve_rules(r.rules),
    'matchId', r.current_match_id,
    'isParty', r.is_party, 'partyLocked', r.party_locked,
    'watchingEnabled', r.watching_enabled,
    'watcherCount', (select count(*) from public.room_watchers where room_id = r.id),
    'partyTurnSeconds', (private.ludo_resolve_rules(coalesce(nullif(r.match_rules, '{}'::jsonb), r.rules))->>'turnSeconds')::int,
    'matchEndsAt', r.match_ends_at,
    'videoAllowed', private.ludo_table_video_allowed(r.id),
    'diceCommitment', (select m.dice_commitment from public.matches m where m.id = r.current_match_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name, 'color', p.color,
      'status', p.status, 'isBot', p.is_bot, 'missedDecisionCount', p.missed_decision_count,
      'level', coalesce((select pr.level from public.player_progression pr where pr.user_id = p.user_id), 1),
      'testWalletBalance', p.test_wallet_balance, 'autoRollEnabled', p.auto_roll_enabled,
      'rematchReady', p.rematch_ready, 'inVoice', p.in_voice, 'cameraOn', p.camera_on, 'partyRemote', p.party_remote,
      'hasCaptured', p.has_captured,
      'avatarId', coalesce((select u.raw_user_meta_data ->> 'avatar_id' from auth.users u where u.id = p.user_id), (array['fox','panda','owl','frog'])[p.seat_index + 1]),
      'country', coalesce((select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id), ''),
      'cosmetics', coalesce((select jsonb_object_agg(pl.type, pl.cosmetic_id)
        from public.player_loadout pl where pl.user_id = p.user_id), '{}'::jsonb)
    ) order by p.seat_index) from public.players p where p.room_id = r.id), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id), 'turnPlayerId', r.turn_player_id,
    'turnPhase', r.turn_phase, 'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value, 'consecutiveSixes', r.consecutive_sixes,
    'pendingDice', to_jsonb(case
      when r.game_type = 'ludo' and r.status = 'in_game'
        and ((r.turn_phase = 'awaiting_roll' and r.consecutive_sixes > 0) or r.turn_phase = 'awaiting_move')
      then r.pending_dice else '{}'::integer[] end),
    'bonusRollPending', r.game_type = 'ludo' and r.status = 'in_game' and r.bonus_roll_pending,
    'legalMoves', case when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null then private.ludo_legal_moves(private.ludo_room_pawns_json(r.id), (select color from public.players where id = r.turn_player_id), r.active_dice_value, r.match_rules, (select has_captured from public.players where id = r.turn_player_id)) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb), 'matchEndReason', r.match_end_reason,
    'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$function$;
revoke execute on function private.ludo_room_state_json(uuid) from public;
