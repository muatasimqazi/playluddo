-- Room voice chat (WebRTC mesh, audio-only). Signaling never goes through a
-- raw client `channel.send()` — realtime.messages has no INSERT policy (see
-- 20260913222114_rls_policies.sql), so every broadcast, this one included,
-- is emitted from a security definer function via realtime.send(). Roster
-- ("who's in the call") reuses the existing state_updated snapshot instead
-- of a parallel channel: it's just one boolean column threaded through
-- ludo_room_state_json, exactly like auto_roll_enabled already is.

alter table public.players add column in_voice boolean not null default false;

-- Redefines the M4 snapshot (20260913232948_m4_rematch.sql) to add inVoice.
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
    'gameType', 'ludo',
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
      when r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null
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

-- Redefines claim_seat (20260913225951_m3_timers_bots_reconnect.sql) so a
-- fresh tab/reconnect never inherits a stale "in call" flag left behind by
-- a previous session that crashed without calling leave_voice.
create or replace function public.claim_seat(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_player_id uuid;
  v_token uuid;
begin
  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  v_token := gen_random_uuid();

  update public.players
  set live_connection_token = v_token, last_seen_at = now(), in_voice = false
  where id = v_caller_player_id;

  return jsonb_build_object('playerId', v_caller_player_id, 'connectionToken', v_token);
end;
$$;

revoke execute on function public.claim_seat(uuid) from public;
grant execute on function public.claim_seat(uuid) to authenticated;

create or replace function public.join_voice(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_player_id uuid;
begin
  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  update public.players set in_voice = true where id = v_caller_player_id;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('inVoice', true);
end;
$$;

revoke execute on function public.join_voice(uuid) from public;
grant execute on function public.join_voice(uuid) to authenticated;

create or replace function public.leave_voice(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_player_id uuid;
begin
  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  update public.players set in_voice = false where id = v_caller_player_id;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('inVoice', false);
end;
$$;

revoke execute on function public.leave_voice(uuid) from public;
grant execute on function public.leave_voice(uuid) to authenticated;

-- WebRTC signaling (SDP offers/answers, ICE candidates). Ephemeral — never
-- persisted, only relayed. `p_to_player_id` must be seated in the same
-- room; the broadcast still reaches every seated client (same as
-- table_message/state_updated), so the payload carries `to` and clients
-- ignore anything not addressed to them.
create or replace function public.send_webrtc_signal(p_room_id uuid, p_to_player_id uuid, p_signal jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid;
begin
  v_from := private.ludo_caller_player_id(p_room_id);
  if v_from is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  if not exists(select 1 from public.players where id = p_to_player_id and room_id = p_room_id) then
    raise exception 'INVALID_SIGNAL_TARGET';
  end if;

  perform realtime.send(
    jsonb_build_object('from', v_from, 'to', p_to_player_id, 'signal', p_signal),
    'webrtc_signal',
    'room:' || p_room_id::text,
    true
  );
end;
$$;

revoke execute on function public.send_webrtc_signal(uuid, uuid, jsonb) from public;
grant execute on function public.send_webrtc_signal(uuid, uuid, jsonb) to authenticated;

revoke execute on function public.join_voice(uuid) from anon;
revoke execute on function public.leave_voice(uuid) from anon;
revoke execute on function public.send_webrtc_signal(uuid, uuid, jsonb) from anon;
