-- A reversible board: room choice is host-only, before the match.
alter table public.rooms add column game_type text not null default 'ludo'
  check (game_type in ('ludo', 'snakes_and_ladders'));

create or replace function private.ludo_room_state_json(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'roomId', r.id,
    'code', r.code,
    'gameType', r.game_type,
    'status', r.status,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'seatIndex', p.seat_index,
        'displayName', p.display_name,
        'color', p.color,
        'status', p.status,
        'isBot', p.is_bot,
        'missedDecisionCount', p.missed_decision_count,
        'level', p.level,
        'testWalletBalance', p.test_wallet_balance,
        'autoRollEnabled', p.auto_roll_enabled,
        'rematchReady', p.rematch_ready,
        'inVoice', p.in_voice
      ) order by p.seat_index)
      from public.players p where p.room_id = r.id
    ), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id),
    'turnPlayerId', r.turn_player_id,
    'turnPhase', r.turn_phase,
    'turnDeadlineAt', r.turn_deadline_at,
    'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value,
    'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case
      when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null
      then private.ludo_legal_moves(
        private.ludo_room_pawns_json(r.id),
        (select color from public.players where id = r.turn_player_id),
        r.active_dice_value
      )
      else '[]'::jsonb
    end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb),
    'matchEndReason', r.match_end_reason,
    'eventSequence', r.event_sequence
  )
  from public.rooms r
  where r.id = p_room_id;
$$;


create or replace function public.start_match(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
  v_seat int;
  v_seat_count int;
  v_first_player_id uuid;
  v_player record;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'ALREADY_STARTED';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null or v_caller_player_id <> v_room.host_player_id then
    raise exception 'NOT_HOST';
  end if;

  select count(*) into v_seat_count from public.players where room_id = p_room_id;
  if v_seat_count < 2 then
    raise exception 'NOT_ENOUGH_PLAYERS';
  end if;

  for v_seat in 0..3 loop
    if not exists (select 1 from public.players where room_id = p_room_id and seat_index = v_seat) then
      insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
      values (p_room_id, v_seat, null, 'Bot ' || (v_seat + 1), private.ludo_color_for_seat(v_seat), 'bot', true);
    end if;
  end loop;

  for v_player in select * from public.players where room_id = p_room_id loop
    insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
    select p_room_id, v_player.id, gs, 'nest', null
    from generate_series(0, case when v_room.game_type = 'ludo' then 3 else 0 end) as gs;
  end loop;

  select id into v_first_player_id from public.players where room_id = p_room_id order by seat_index asc limit 1;

  update public.rooms
  set status = 'in_game',
      turn_player_id = v_first_player_id,
      turn_phase = 'awaiting_roll',
      turn_deadline_at = private.ludo_next_turn_deadline(v_first_player_id),
      rolls_this_turn = 0,
      consecutive_sixes = 0
  where id = p_room_id;

  perform private.ludo_append_event(p_room_id, 'match_started', null, '{}'::jsonb);
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('roomId', p_room_id);
end;
$$;


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

  -- Server-side CSPRNG (docs/PRD.md Section 6.2) — never client-supplied.
  v_die_value := 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 6);
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




create or replace function public.set_room_game(p_room_id uuid, p_game_type text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_caller uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  v_caller := private.ludo_caller_player_id(p_room_id);
  if v_caller is null or v_caller <> v_room.host_player_id then raise exception 'NOT_HOST'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  if p_game_type is null or p_game_type not in ('ludo', 'snakes_and_ladders') then raise exception 'INVALID_GAME_TYPE'; end if;
  if v_room.game_type <> p_game_type then
    update public.rooms set game_type = p_game_type where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'board_flipped', v_caller, jsonb_build_object('gameType', p_game_type));
    perform private.ludo_broadcast_state(p_room_id);
  end if;
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.set_room_game(uuid, text) from public;
grant execute on function public.set_room_game(uuid, text) to authenticated;

-- Mirrors lib/board/snakes.ts and the endpoints in the supplied artwork.
create or replace function private.snakes_move(p_pawns jsonb, p_color text, p_die int)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_pawn jsonb; v_landing int; v_destination int;
begin
  if p_die is null or p_die not between 1 and 6 then return null; end if;
  select p into v_pawn from jsonb_array_elements(p_pawns) p
    where p->>'color' = p_color and p->>'state' <> 'finished' limit 1;
  if v_pawn is null then return null; end if;
  v_landing := coalesce((v_pawn->>'pathIndex')::int, 0) + p_die;
  if v_landing > 100 then return null; end if;
  v_destination := case v_landing
    when 4 then 16 when 9 then 30 when 21 then 42 when 50 then 68 when 63 then 81 when 71 then 91
    when 14 then 6 when 36 then 24 when 54 then 46 when 64 then 59 when 94 then 88 when 98 then 78
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

-- The die value is supplied only by the private random-roll dispatcher.
-- Keeping resolution separate allows deterministic SQL/TypeScript parity tests.
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
  if not v_complete then perform private.ludo_advance_to_next_player(p_room_id); end if;
  perform private.ludo_broadcast_state(p_room_id);
  return jsonb_build_object('dieValue', p_die, 'legalMoves', '[]'::jsonb, 'cancelledByThirdSix', false);
end;
$$;
revoke execute on function private.snakes_apply_roll(uuid, uuid, int) from public;

-- Existing authenticated RPCs and timeout/bot handling keep their locks and
-- session checks, then dispatch to the room's game. Ludo rules are unchanged.
create or replace function private.ludo_perform_roll(p_room_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_byte int;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.status <> 'in_game' then raise exception 'INVALID_PHASE'; end if;
  if v_room.game_type = 'ludo' then
    return private.ludo_perform_ludo_roll(p_room_id, p_player_id);
  end if;
  loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    exit when v_byte < 252;
  end loop;
  return private.snakes_apply_roll(p_room_id, p_player_id, 1 + v_byte % 6);
end;
$$;
revoke execute on function private.ludo_perform_roll(uuid, uuid) from public;

-- Allow a roll + six steps + the longest slide to finish before a bot rolls.
create or replace function private.ludo_next_turn_deadline(p_player_id uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select case
    when private.ludo_is_bot_controlled(p_player_id) then now() + case
      when exists (select 1 from public.players p join public.rooms r on r.id = p.room_id
        where p.id = p_player_id and r.game_type = 'snakes_and_ladders')
      then interval '5.5 seconds' else interval '2 seconds' end
    else now() + interval '15 seconds'
  end;
$$;
revoke execute on function private.ludo_next_turn_deadline(uuid) from public;

