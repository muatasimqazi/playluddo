-- Rematch flow (PRD 5.3): request_rematch/accept_rematch both vote "yes" on
-- the same room — the client can label the button differently ("Request
-- Rematch" for the first mover, "Accept" for everyone after), but the
-- server-side effect is identical, so both call the same private helper.
-- Bots auto-accept by construction: quorum only requires CONNECTED HUMAN
-- players to have voted, so a bot seat never blocks it.

alter table public.players
  add column rematch_ready boolean not null default false;

alter table public.rooms
  add column rematch_requested_at timestamptz;

-- True once every connected human has voted yes. Vacuous-true (zero
-- connected humans) can't actually trigger a rematch in practice: this is
-- only ever invoked as a side effect of a human's own RPC call, and a
-- disconnected-only room has no one left to place that call.
create or replace function private.ludo_maybe_start_rematch(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_all_ready boolean;
begin
  select not exists (
    select 1 from public.players
    where room_id = p_room_id and status = 'connected' and is_bot = false and rematch_ready = false
  ) into v_all_ready;

  if not v_all_ready then
    return;
  end if;

  delete from public.pawns where room_id = p_room_id;

  update public.players
  set rematch_ready = false, missed_decision_count = 0
  where room_id = p_room_id;

  update public.rooms
  set status = 'lobby',
      turn_player_id = null,
      turn_phase = 'awaiting_roll',
      turn_deadline_at = null,
      active_dice_value = null,
      consecutive_sixes = 0,
      rolls_this_turn = 0,
      winner_ids = '{}',
      match_end_reason = null,
      all_absent_since = null,
      rematch_requested_at = null
  where id = p_room_id;

  perform private.ludo_append_event(p_room_id, 'rematch_accepted', null, '{}'::jsonb);
end;
$$;

revoke execute on function private.ludo_maybe_start_rematch(uuid) from public;

create or replace function private.ludo_vote_rematch(p_room_id uuid, p_player_id uuid, p_event_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_at timestamptz;
begin
  select rematch_requested_at into v_requested_at from public.rooms where id = p_room_id;

  -- Expire a stale window (60s, PRD 5.3) before applying this vote, so a
  -- second wave of interest starts a fresh quorum rather than inheriting
  -- votes cast against an earlier, abandoned request.
  if v_requested_at is not null and now() - v_requested_at > interval '60 seconds' then
    update public.players set rematch_ready = false where room_id = p_room_id;
    v_requested_at := null;
  end if;

  if v_requested_at is null then
    update public.rooms set rematch_requested_at = now() where id = p_room_id;
  end if;

  update public.players set rematch_ready = true where id = p_player_id;

  perform private.ludo_append_event(p_room_id, p_event_type, p_player_id, '{}'::jsonb);
  perform private.ludo_maybe_start_rematch(p_room_id);
  perform private.ludo_broadcast_state(p_room_id);
end;
$$;

revoke execute on function private.ludo_vote_rematch(uuid, uuid, text) from public;

create or replace function public.request_rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'summary' then
    raise exception 'ROOM_NOT_IN_SUMMARY';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  perform private.ludo_vote_rematch(p_room_id, v_caller_player_id, 'rematch_requested');

  return jsonb_build_object('playerId', v_caller_player_id);
end;
$$;

revoke execute on function public.request_rematch(uuid) from public;
grant execute on function public.request_rematch(uuid) to authenticated;

create or replace function public.accept_rematch(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'summary' then
    raise exception 'ROOM_NOT_IN_SUMMARY';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  perform private.ludo_vote_rematch(p_room_id, v_caller_player_id, 'rematch_accepted_vote');

  return jsonb_build_object('playerId', v_caller_player_id);
end;
$$;

revoke execute on function public.accept_rematch(uuid) from public;
grant execute on function public.accept_rematch(uuid) to authenticated;

-- Extends the M3 snapshot with rematchReady so the summary screen can show
-- who's already voted.
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
        'rematchReady', p.rematch_ready
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
