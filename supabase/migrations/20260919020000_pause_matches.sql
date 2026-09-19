alter table public.rooms add column paused_at timestamptz;

create or replace function public.toggle_match_pause(p_room_id uuid, p_paused boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_player_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  v_player_id := private.ludo_caller_player_id(p_room_id);
  if v_player_id is distinct from v_room.host_player_id then raise exception 'NOT_HOST'; end if;
  if v_room.status <> 'in_game' then raise exception 'INVALID_PHASE'; end if;
  if p_paused and v_room.paused_at is null then
    update public.rooms set paused_at = now() where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'match_paused', v_player_id, '{}'::jsonb);
  elsif not p_paused and v_room.paused_at is not null then
    update public.rooms set turn_deadline_at = case when turn_deadline_at is null then null else turn_deadline_at + (now() - paused_at) end, paused_at = null where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'match_resumed', v_player_id, '{}'::jsonb);
  end if;
  perform private.ludo_broadcast_state(p_room_id);
  return private.ludo_room_state_json(p_room_id);
end; $$;
revoke execute on function public.toggle_match_pause(uuid, boolean) from public;
grant execute on function public.toggle_match_pause(uuid, boolean) to authenticated;

create or replace function public.sweep_expired_turns()
returns void language plpgsql security definer set search_path = '' as $$
declare v_room_id uuid;
begin
  for v_room_id in select id from public.rooms where status = 'in_game' and paused_at is null and turn_deadline_at is not null and turn_deadline_at <= now() for update skip locked loop
    perform private.ludo_resolve_turn_timeout(v_room_id);
    perform private.ludo_check_abandonment(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
end; $$;
revoke execute on function public.sweep_expired_turns() from public;

create or replace function private.ludo_room_state_json(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'roomId', r.id, 'hostPlayerId', r.host_player_id, 'code', r.code, 'gameType', r.game_type,
    'status', r.status, 'paused', r.paused_at is not null,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name, 'color', p.color,
      'status', p.status, 'isBot', p.is_bot, 'missedDecisionCount', p.missed_decision_count,
      'level', p.level, 'testWalletBalance', p.test_wallet_balance, 'autoRollEnabled', p.auto_roll_enabled,
      'rematchReady', p.rematch_ready, 'inVoice', p.in_voice,
      'avatarId', coalesce((select u.raw_user_meta_data ->> 'avatar_id' from auth.users u where u.id = p.user_id), (array['fox','panda','owl','frog'])[p.seat_index + 1]),
      'country', coalesce((select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id), '')
    ) order by p.seat_index) from public.players p where p.room_id = r.id), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id), 'turnPlayerId', r.turn_player_id,
    'turnPhase', r.turn_phase, 'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value, 'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null then private.ludo_legal_moves(private.ludo_room_pawns_json(r.id), (select color from public.players where id = r.turn_player_id), r.active_dice_value) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb), 'matchEndReason', r.match_end_reason,
    'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$$;
