-- Players may choose any unoccupied base while a room is in the lobby.
create unique index players_room_color_idx on public.players (room_id, color);

create or replace function private.ludo_room_state_json(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'roomId', r.id,
    'hostPlayerId', r.host_player_id,
    'code', r.code,
    'gameType', r.game_type,
    'status', r.status,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name,
        'color', p.color, 'status', p.status, 'isBot', p.is_bot,
        'missedDecisionCount', p.missed_decision_count, 'level', p.level,
        'testWalletBalance', p.test_wallet_balance,
        'autoRollEnabled', p.auto_roll_enabled,
        'rematchReady', p.rematch_ready, 'inVoice', p.in_voice
      ) order by p.seat_index)
      from public.players p where p.room_id = r.id
    ), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id),
    'turnPlayerId', r.turn_player_id, 'turnPhase', r.turn_phase,
    'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value,
    'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case
      when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move'
        and r.turn_player_id is not null and r.active_dice_value is not null
      then private.ludo_legal_moves(
        private.ludo_room_pawns_json(r.id),
        (select color from public.players where id = r.turn_player_id),
        r.active_dice_value
      ) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb),
    'matchEndReason', r.match_end_reason, 'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms; v_existing_player_id uuid; v_seat_index int; v_player_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  select id into v_existing_player_id from public.players
    where room_id = v_room.id and user_id = (select auth.uid());
  if v_existing_player_id is not null then
    return jsonb_build_object('roomId', v_room.id, 'code', v_room.code, 'playerId', v_existing_player_id);
  end if;
  select seat into v_seat_index from generate_series(0, 3) seat
    where not exists (
      select 1 from public.players p where p.room_id = v_room.id and p.seat_index = seat
    ) order by seat limit 1;
  if v_seat_index is null then raise exception 'ROOM_FULL'; end if;
  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (v_room.id, v_seat_index, (select auth.uid()), p_display_name,
    private.ludo_color_for_seat(v_seat_index), 'connected', false)
  returning id into v_player_id;
  perform private.ludo_broadcast_state(v_room.id);
  return jsonb_build_object('roomId', v_room.id, 'code', v_room.code, 'playerId', v_player_id);
end;
$$;
revoke execute on function public.join_room(text, text) from public;
grant execute on function public.join_room(text, text) to authenticated;

create or replace function public.set_player_color(p_room_id uuid, p_color text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_player_id uuid; v_seat_index int;
begin
  if p_color not in ('red', 'green', 'yellow', 'blue') then raise exception 'INVALID_COLOR'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  v_player_id := private.ludo_caller_player_id(p_room_id);
  if v_player_id is null then raise exception 'UNAUTHENTICATED'; end if;
  v_seat_index := case p_color when 'red' then 0 when 'green' then 1
    when 'yellow' then 2 when 'blue' then 3 end;
  if exists (
    select 1 from public.players
    where room_id = p_room_id and color = p_color and id <> v_player_id
  ) then raise exception 'COLOR_TAKEN'; end if;
  update public.players set color = p_color, seat_index = v_seat_index
    where id = v_player_id;
  perform private.ludo_broadcast_state(p_room_id);
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.set_player_color(uuid, text) from public;
grant execute on function public.set_player_color(uuid, text) to authenticated;
