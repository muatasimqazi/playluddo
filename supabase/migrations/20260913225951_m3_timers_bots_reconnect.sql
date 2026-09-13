-- M3: turn-timer sweep job, bot takeover, reconnect, duplicate-session
-- handling. Per docs/IMPLEMENTATION_HANDOFF.md Section 10 / docs/PRD.md
-- Section 5.2. Same review requirement as prior migrations: AI-authored,
-- needs product owner sign-off before staging/production.
--
-- Key design move: request_roll/request_move are split into a thin
-- authorization wrapper (public.*) and a shared action body
-- (private.ludo_perform_*), so a real player's direct call and the sweep
-- job's auto-action call the exact same code — this is the mechanism that
-- makes "must not diverge by trigger source" (PRD 5.2/6.8) actually true,
-- rather than aspirational.
--
-- Disconnect-detection scope note: `last_seen_at` is updated only by calls
-- that are inherently tied to a player being present for their own turn
-- (request_roll, request_move, claim_seat, reclaim_seat) — there is no
-- ambient heartbeat. This means the "disconnect > 45s" trigger below is
-- only ever evaluated once a player has ALREADY missed their own decision
-- window (turn_deadline_at expired while it was their turn) — it does NOT
-- detect a disconnect that happens while it isn't yet their turn. True
-- out-of-turn presence detection needs Realtime Presence, which is client
-- wiring deferred to M4. This is a deliberate, documented scope boundary,
-- not an oversight.

alter table public.players
  add column auto_roll_enabled boolean not null default false,
  add column last_seen_at timestamptz not null default now();

alter table public.rooms
  add column all_absent_since timestamptz;

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

-- True if this seat should act without waiting for the human decision
-- window: a genuine bot seat, a human seat taken over due to inactivity, or
-- a human who has explicitly opted into Auto-Roll (PRD 5.2).
create or replace function private.ludo_is_bot_controlled(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(is_bot or status = 'bot' or auto_roll_enabled, false)
  from public.players
  where id = p_player_id;
$$;

revoke execute on function private.ludo_is_bot_controlled(uuid) from public;

-- The deadline to set when it becomes p_player_id's decision: immediate
-- (picked up on the next ~1s sweep tick) if bot-controlled, else the normal
-- 15s human decision window (PRD 5.2).
create or replace function private.ludo_next_turn_deadline(p_player_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.ludo_is_bot_controlled(p_player_id) then now()
    else now() + interval '15 seconds'
  end;
$$;

revoke execute on function private.ludo_next_turn_deadline(uuid) from public;

-- ---------------------------------------------------------------------------
-- Shared action bodies — extracted from M2's request_roll/request_move so
-- the sweep job's auto-actions and a real player's direct calls are
-- byte-for-byte the same code path. Callers must already hold the room's
-- row lock and have validated whatever authorization applies to them.
-- ---------------------------------------------------------------------------

create or replace function private.ludo_perform_roll(p_room_id uuid, p_player_id uuid)
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

revoke execute on function private.ludo_perform_roll(uuid, uuid) from public;

create or replace function private.ludo_perform_move(p_room_id uuid, p_player_id uuid, p_pawn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
begin
  select * into v_room from public.rooms where id = p_room_id;
  select color into v_mover_color from public.players where id = p_player_id;

  -- Re-derive legality from the current database state — a client-supplied
  -- (or bot-chosen) pawnId is a request, never a fact.
  v_pawns_json := private.ludo_room_pawns_json(p_room_id);
  v_legal_moves := private.ludo_legal_moves(v_pawns_json, v_mover_color, v_room.active_dice_value);

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

  perform private.ludo_append_event(p_room_id, 'legal_move_selected', p_player_id, v_move);

  v_won := private.ludo_is_match_won(v_new_pawns, v_mover_color);

  if v_won then
    -- PRD 4.4: match ends immediately on the first finish.
    update public.rooms
    set status = 'summary',
        winner_ids = array[p_player_id],
        match_end_reason = 'completed',
        turn_phase = 'complete'
    where id = p_room_id;

    perform private.ludo_append_event(p_room_id, 'match_completed', p_player_id, jsonb_build_object('winnerId', p_player_id));
  else
    v_bonus := private.ludo_earns_bonus_roll(v_room.active_dice_value, v_move);
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
$$;

revoke execute on function private.ludo_perform_move(uuid, uuid, uuid) from public;

-- Turn rotation now hands the deadline decision to ludo_next_turn_deadline
-- instead of a hardcoded 15s, so a bot-controlled next player is picked up
-- on the very next sweep tick rather than waiting out a human-length timer.
create or replace function private.ludo_advance_to_next_player(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_seat int;
  v_next_player_id uuid;
begin
  select seat_index into v_current_seat
  from public.players
  where room_id = p_room_id
    and id = (select turn_player_id from public.rooms where id = p_room_id);

  select id into v_next_player_id
  from public.players
  where room_id = p_room_id and seat_index > coalesce(v_current_seat, -1)
  order by seat_index asc
  limit 1;

  if v_next_player_id is null then
    select id into v_next_player_id
    from public.players
    where room_id = p_room_id
    order by seat_index asc
    limit 1;
  end if;

  update public.rooms
  set turn_player_id = v_next_player_id,
      turn_phase = 'awaiting_roll',
      turn_deadline_at = private.ludo_next_turn_deadline(v_next_player_id),
      active_dice_value = null,
      consecutive_sixes = 0,
      rolls_this_turn = 0
  where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Timeout resolution — the sweep job's core. Assumes the caller already
-- holds the room's row lock (both callers below take `for update` first).
-- ---------------------------------------------------------------------------

create or replace function private.ludo_resolve_turn_timeout(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
    v_legal_moves := private.ludo_legal_moves(v_pawns_json, v_player.color, v_room.active_dice_value);
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
$$;

revoke execute on function private.ludo_resolve_turn_timeout(uuid) from public;

-- Abandonment (PRD 5.2): if no seated player is 'connected', start (or
-- continue) a 3-minute clock; end the match as abandoned once it elapses.
-- Piggybacks on the same sweep pass rather than a separate query, because a
-- room with zero connected humans always has an imminently-expiring
-- turn_deadline_at (every bot-controlled turn gets an immediate deadline),
-- so it's swept every tick regardless.
create or replace function private.ludo_check_abandonment(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_any_connected boolean;
  v_all_absent_since timestamptz;
begin
  select exists(
    select 1 from public.players where room_id = p_room_id and status = 'connected'
  ) into v_any_connected;

  if v_any_connected then
    update public.rooms set all_absent_since = null where id = p_room_id and all_absent_since is not null;
    return;
  end if;

  select all_absent_since into v_all_absent_since from public.rooms where id = p_room_id;

  if v_all_absent_since is null then
    update public.rooms set all_absent_since = now() where id = p_room_id;
    return;
  end if;

  if now() - v_all_absent_since > interval '3 minutes' then
    update public.rooms
    set status = 'abandoned', match_end_reason = 'abandoned', turn_phase = 'complete'
    where id = p_room_id;

    perform private.ludo_append_event(p_room_id, 'match_abandoned', null, '{}'::jsonb);
  end if;
end;
$$;

revoke execute on function private.ludo_check_abandonment(uuid) from public;

-- ---------------------------------------------------------------------------
-- The sweep job itself — cron-only, no client can call it directly.
-- ---------------------------------------------------------------------------

create or replace function public.sweep_expired_turns()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  for v_room_id in
    select id from public.rooms
    where status = 'in_game' and turn_deadline_at is not null and turn_deadline_at <= now()
    for update skip locked
  loop
    perform private.ludo_resolve_turn_timeout(v_room_id);
    perform private.ludo_check_abandonment(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
end;
$$;

-- No EXECUTE grant to authenticated/anon at all — only pg_cron (running as
-- the migration owner) can invoke this. This IS the enforcement; there is
-- no separate flag marking it "internal".
revoke execute on function public.sweep_expired_turns() from public;

-- ---------------------------------------------------------------------------
-- Public RPCs: request_roll/request_move gain an optional connection-token
-- check (duplicate-session detection); toggle_auto_roll, claim_seat,
-- reclaim_seat are new.
-- ---------------------------------------------------------------------------

drop function if exists public.request_roll(uuid);

create or replace function public.request_roll(p_room_id uuid, p_connection_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
  v_stored_token uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null or v_caller_player_id <> v_room.turn_player_id then
    raise exception 'NOT_YOUR_TURN';
  end if;
  if v_room.turn_phase <> 'awaiting_roll' then
    raise exception 'INVALID_PHASE';
  end if;

  -- Duplicate-session guard (PRD 5.2): a stale tab whose token no longer
  -- matches (a newer claim_seat call replaced it) is rejected outright.
  -- Omitting the token skips this check — kept optional so existing/simple
  -- callers (and M2's tests) don't have to claim a seat first.
  if p_connection_token is not null then
    select live_connection_token into v_stored_token from public.players where id = v_caller_player_id;
    if v_stored_token is distinct from p_connection_token then
      raise exception 'SESSION_REPLACED';
    end if;
  end if;

  update public.players set missed_decision_count = 0, last_seen_at = now() where id = v_caller_player_id;

  return private.ludo_perform_roll(p_room_id, v_caller_player_id);
end;
$$;

revoke execute on function public.request_roll(uuid, uuid) from public;
grant execute on function public.request_roll(uuid, uuid) to authenticated;

drop function if exists public.request_move(uuid, uuid);

create or replace function public.request_move(p_room_id uuid, p_pawn_id uuid, p_connection_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
  v_stored_token uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null or v_caller_player_id <> v_room.turn_player_id then
    raise exception 'NOT_YOUR_TURN';
  end if;
  if v_room.turn_phase <> 'awaiting_move' then
    raise exception 'INVALID_PHASE';
  end if;

  if p_connection_token is not null then
    select live_connection_token into v_stored_token from public.players where id = v_caller_player_id;
    if v_stored_token is distinct from p_connection_token then
      raise exception 'SESSION_REPLACED';
    end if;
  end if;

  update public.players set missed_decision_count = 0, last_seen_at = now() where id = v_caller_player_id;

  return private.ludo_perform_move(p_room_id, v_caller_player_id, p_pawn_id);
end;
$$;

revoke execute on function public.request_move(uuid, uuid, uuid) from public;
grant execute on function public.request_move(uuid, uuid, uuid) to authenticated;

-- Issues a fresh connection token for the caller's own seat, invalidating
-- whatever token an older tab/session was holding. Called once when a
-- client takes control of a seat (PRD 5.2, 6.3).
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
  set live_connection_token = v_token, last_seen_at = now()
  where id = v_caller_player_id;

  return jsonb_build_object('playerId', v_caller_player_id, 'connectionToken', v_token);
end;
$$;

revoke execute on function public.claim_seat(uuid) from public;
grant execute on function public.claim_seat(uuid) to authenticated;

-- A player opts their own seat into server-chosen actions (PRD 5.2),
-- distinct from timeout-driven auto-actions. If it's currently their turn,
-- resolves it immediately rather than waiting for the next sweep tick.
create or replace function public.toggle_auto_roll(p_room_id uuid, p_enabled boolean)
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

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  update public.players set auto_roll_enabled = p_enabled where id = v_caller_player_id;

  if p_enabled and v_room.status = 'in_game' and v_room.turn_player_id = v_caller_player_id then
    perform private.ludo_resolve_turn_timeout(p_room_id);
  end if;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('autoRollEnabled', p_enabled);
end;
$$;

revoke execute on function public.toggle_auto_roll(uuid, boolean) from public;
grant execute on function public.toggle_auto_roll(uuid, boolean) to authenticated;

-- Reconnect flow (PRD 5.2): the original human on a disconnected/inactive/
-- bot-taken-over seat reclaims it. Locking the room first means this can't
-- race an in-flight sweep resolution for the same room — whichever
-- transaction gets the lock first completes fully before the other
-- proceeds, which is what "applied at the next phase boundary, not
-- mid-resolution" means in practice.
create or replace function public.reclaim_seat(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_player_id uuid;
  v_status text;
begin
  perform 1 from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'NOTHING_TO_RECLAIM';
  end if;

  select status into v_status from public.players where id = v_caller_player_id;
  if v_status = 'connected' then
    raise exception 'NOTHING_TO_RECLAIM';
  end if;

  update public.players
  set status = 'connected', missed_decision_count = 0, last_seen_at = now()
  where id = v_caller_player_id;

  perform private.ludo_append_event(p_room_id, 'player_reconnected', v_caller_player_id, '{}'::jsonb);
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('playerId', v_caller_player_id);
end;
$$;

revoke execute on function public.reclaim_seat(uuid) from public;
grant execute on function public.reclaim_seat(uuid) to authenticated;

-- start_match's initial deadline goes through the same helper as everywhere
-- else, for consistency (seat 0 is always the human host today, but this
-- keeps the invariant "every turn_deadline_at assignment is bot-aware" true
-- without a special case).
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
    from generate_series(0, 3) as gs;
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

-- Extends the M2 snapshot with autoRollEnabled (PRD 5.2's Auto-Roll toggle
-- wasn't itemized in PRD 6.7's original Player shape — this is the same
-- extension, mirrored in lib/board/types.ts's Player interface).
create or replace function private.ludo_room_state_json(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'roomId', r.id,
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
        'autoRollEnabled', p.auto_roll_enabled
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
