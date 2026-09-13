-- Core RPC surface: create/join/fill_bot/start_match/request_roll/
-- request_move/get_room_state. Per docs/IMPLEMENTATION_HANDOFF.md Section 6:
-- these compose the pure building blocks from the rules-engine migration —
-- no new rules logic is written here, only reading rows into the jsonb
-- shape those functions expect, calling them, and writing the result back.
--
-- Same review requirement as the RLS migration: AI-authored, needs product
-- owner sign-off before staging/production (docs/PRD.md Section 10 #8).
--
-- Deferred to M3 (timers/bots/reconnect): toggle_auto_roll, reclaim_seat,
-- sweep_expired_turns, and the duplicate-session (`live_connection_token`)
-- check on every RPC. Deferred to M4 (summary/rematch flow):
-- request_rematch/accept_rematch. Every RPC below already re-derives
-- legality and authorization from the database on every call — nothing here
-- trusts a client-supplied claim about game state, so adding those later
-- doesn't require revisiting what's here.

-- ---------------------------------------------------------------------------
-- Private state-shaping helpers
-- ---------------------------------------------------------------------------

-- Bridges DB rows to the EnginePawn jsonb shape the rules engine expects
-- (docs/IMPLEMENTATION_HANDOFF.md Section 3 / lib/board/engine-types.ts).
create or replace function private.ludo_room_pawns_json(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pawns.id::text,
    'color', players.color,
    'index', pawns.pawn_index,
    'state', pawns.state,
    'pathIndex', pawns.path_index
  ) order by players.seat_index, pawns.pawn_index), '[]'::jsonb)
  from public.pawns
  join public.players on players.id = pawns.player_id
  where pawns.room_id = p_room_id;
$$;

revoke execute on function private.ludo_room_pawns_json(uuid) from public;

-- Full GameRoomState snapshot (docs/PRD.md Section 6.7) — used by
-- get_room_state and every broadcast. legalMoves is deliberately NOT a
-- stored column: it's pure/derived from (pawns, activeDiceValue), so it's
-- recomputed here on every read rather than risking staleness.
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
        'testWalletBalance', p.test_wallet_balance
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

revoke execute on function private.ludo_room_state_json(uuid) from public;

create or replace function private.ludo_color_for_seat(p_seat_index int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_seat_index
    when 0 then 'red'
    when 1 then 'green'
    when 2 then 'yellow'
    when 3 then 'blue'
    else null
  end;
$$;

revoke execute on function private.ludo_color_for_seat(int) from public;

-- Room join codes: decent entropy (pgcrypto CSPRNG, not plain random()) and
-- an unambiguous alphabet (no 0/O/1/I/L) since players type these by hand.
-- Not cryptographic secrecy on its own — PRD 5.1 pairs this with
-- join-attempt rate limiting, deferred to M3's abuse-hardening pass.
create or replace function private.ludo_generate_room_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_exists boolean;
  i int;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_chars)), 1);
    end loop;
    select exists(select 1 from public.rooms where code = v_code) into v_exists;
    exit when not v_exists;
  end loop;
  return v_code;
end;
$$;

revoke execute on function private.ludo_generate_room_code() from public;

-- Appends one match_events row and advances rooms.event_sequence, atomically.
-- Assumes the caller already holds the row lock on `rooms` (every RPC below
-- takes `select ... for update` before calling this).
create or replace function private.ludo_append_event(
  p_room_id uuid,
  p_event_type text,
  p_player_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence bigint;
begin
  update public.rooms set event_sequence = event_sequence + 1
  where id = p_room_id
  returning event_sequence into v_sequence;

  insert into public.match_events (room_id, sequence, event_type, player_id, payload)
  values (p_room_id, v_sequence, p_event_type, p_player_id, p_payload);

  return v_sequence;
end;
$$;

revoke execute on function private.ludo_append_event(uuid, text, uuid, jsonb) from public;

-- Rotates turn_player_id to the next seated player by seat_index (wrapping),
-- and resets the per-turn fields. No skipping logic yet — every seated
-- player (bot or human) gets a turn in order; bot-takeover pacing is M3.
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
      turn_deadline_at = now() + interval '15 seconds',
      active_dice_value = null,
      consecutive_sixes = 0,
      rolls_this_turn = 0
  where id = p_room_id;
end;
$$;

revoke execute on function private.ludo_advance_to_next_player(uuid) from public;

-- Broadcasts the current room snapshot on the room's Realtime channel.
-- realtime.send() is called from inside the same transaction as the state
-- write that triggered it (docs/PRD.md Section 6.3), so a broadcast is
-- never sent for a write that then rolls back.
create or replace function private.ludo_broadcast_state(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select realtime.send(
    private.ludo_room_state_json(p_room_id),
    'state_updated',
    'room:' || p_room_id::text,
    true
  );
$$;

revoke execute on function private.ludo_broadcast_state(uuid) from public;

-- ---------------------------------------------------------------------------
-- Public RPC surface
-- ---------------------------------------------------------------------------

create or replace function public.create_room(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
  v_player_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  v_code := private.ludo_generate_room_code();

  insert into public.rooms (code, status)
  values (v_code, 'lobby')
  returning id into v_room_id;

  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (v_room_id, 0, (select auth.uid()), p_display_name, private.ludo_color_for_seat(0), 'connected', false)
  returning id into v_player_id;

  update public.rooms set host_player_id = v_player_id where id = v_room_id;

  return jsonb_build_object('roomId', v_room_id, 'code', v_code, 'playerId', v_player_id);
end;
$$;

revoke execute on function public.create_room(text) from public;
grant execute on function public.create_room(text) to authenticated;

create or replace function public.join_room(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_existing_player_id uuid;
  v_seat_count int;
  v_seat_index int;
  v_player_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'ALREADY_STARTED';
  end if;

  select id into v_existing_player_id
  from public.players
  where room_id = v_room.id and user_id = (select auth.uid());

  if v_existing_player_id is not null then
    -- Idempotent: a page refresh re-calling join_room returns the same seat
    -- rather than erroring or duplicating it.
    return jsonb_build_object('roomId', v_room.id, 'code', v_room.code, 'playerId', v_existing_player_id);
  end if;

  select count(*) into v_seat_count from public.players where room_id = v_room.id;
  if v_seat_count >= 4 then
    raise exception 'ROOM_FULL';
  end if;

  v_seat_index := v_seat_count;

  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (v_room.id, v_seat_index, (select auth.uid()), p_display_name, private.ludo_color_for_seat(v_seat_index), 'connected', false)
  returning id into v_player_id;

  return jsonb_build_object('roomId', v_room.id, 'code', v_room.code, 'playerId', v_player_id);
end;
$$;

revoke execute on function public.join_room(text, text) from public;
grant execute on function public.join_room(text, text) to authenticated;

create or replace function public.fill_bot(p_room_id uuid, p_seat_index int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
  v_player_id uuid;
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

  if exists (select 1 from public.players where room_id = p_room_id and seat_index = p_seat_index) then
    raise exception 'SEAT_TAKEN';
  end if;

  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (p_room_id, p_seat_index, null, 'Bot ' || (p_seat_index + 1), private.ludo_color_for_seat(p_seat_index), 'bot', true)
  returning id into v_player_id;

  return jsonb_build_object('playerId', v_player_id);
end;
$$;

revoke execute on function public.fill_bot(uuid, int) from public;
grant execute on function public.fill_bot(uuid, int) to authenticated;

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
      turn_deadline_at = now() + interval '15 seconds',
      rolls_this_turn = 0,
      consecutive_sixes = 0
  where id = p_room_id;

  perform private.ludo_append_event(p_room_id, 'match_started', null, '{}'::jsonb);
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('roomId', p_room_id);
end;
$$;

revoke execute on function public.start_match(uuid) from public;
grant execute on function public.start_match(uuid) to authenticated;

create or replace function public.request_roll(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
  v_die_value int;
  v_six_eval jsonb;
  v_mover_color text;
  v_legal_moves jsonb;
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

  -- Server-side CSPRNG (docs/PRD.md Section 6.2) — never client-supplied.
  v_die_value := 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 6);
  v_six_eval := private.ludo_evaluate_six_roll(v_room.consecutive_sixes, v_die_value);

  perform private.ludo_append_event(p_room_id, 'dice_rolled', v_caller_player_id, jsonb_build_object(
    'dieValue', v_die_value,
    'cancelledByThirdSix', v_six_eval->'cancelMove'
  ));

  if (v_six_eval->>'cancelMove')::boolean then
    -- Third consecutive six: this roll's move is cancelled, turn ends now.
    perform private.ludo_advance_to_next_player(p_room_id);
    perform private.ludo_broadcast_state(p_room_id);
    return jsonb_build_object('dieValue', v_die_value, 'legalMoves', '[]'::jsonb, 'cancelledByThirdSix', true);
  end if;

  select color into v_mover_color from public.players where id = v_caller_player_id;
  v_legal_moves := private.ludo_legal_moves(private.ludo_room_pawns_json(p_room_id), v_mover_color, v_die_value);

  if jsonb_array_length(v_legal_moves) = 0 then
    -- No-move turn (PRD 4.2): the server advances immediately; the client's
    -- 1.5s "no move" acknowledgement is purely a display-pacing concern, not
    -- something the server holds a phase open for.
    update public.rooms set consecutive_sixes = (v_six_eval->>'consecutiveSixesAfter')::int where id = p_room_id;
    perform private.ludo_advance_to_next_player(p_room_id);
  else
    update public.rooms
    set active_dice_value = v_die_value,
        turn_phase = 'awaiting_move',
        turn_deadline_at = now() + interval '15 seconds',
        rolls_this_turn = rolls_this_turn + 1,
        consecutive_sixes = (v_six_eval->>'consecutiveSixesAfter')::int
    where id = p_room_id;
  end if;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('dieValue', v_die_value, 'legalMoves', v_legal_moves, 'cancelledByThirdSix', false);
end;
$$;

revoke execute on function public.request_roll(uuid) from public;
grant execute on function public.request_roll(uuid) to authenticated;

create or replace function public.request_move(p_room_id uuid, p_pawn_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
  v_mover_color text;
  v_pawns_json jsonb;
  v_legal_moves jsonb;
  v_move jsonb;
  v_new_pawns jsonb;
  v_pawn jsonb;
  v_won boolean;
  v_bonus boolean;
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

  select color into v_mover_color from public.players where id = v_caller_player_id;

  -- Re-derive legality from the current database state — the client's
  -- claim that p_pawn_id is legal is a request, never a fact.
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

  perform private.ludo_append_event(p_room_id, 'legal_move_selected', v_caller_player_id, v_move);

  v_won := private.ludo_is_match_won(v_new_pawns, v_mover_color);

  if v_won then
    -- PRD 4.4: match ends immediately on the first finish — no further play
    -- to determine 2nd/3rd/4th.
    update public.rooms
    set status = 'summary',
        winner_ids = array[v_caller_player_id],
        match_end_reason = 'completed',
        turn_phase = 'complete'
    where id = p_room_id;

    perform private.ludo_append_event(p_room_id, 'match_completed', v_caller_player_id, jsonb_build_object('winnerId', v_caller_player_id));
  else
    v_bonus := private.ludo_earns_bonus_roll(v_room.active_dice_value, v_move);
    if v_bonus then
      update public.rooms
      set turn_phase = 'awaiting_roll',
          turn_deadline_at = now() + interval '15 seconds',
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

revoke execute on function public.request_move(uuid, uuid) from public;
grant execute on function public.request_move(uuid, uuid) to authenticated;

create or replace function public.get_room_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
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
  return private.ludo_room_state_json(p_room_id);
end;
$$;

revoke execute on function public.get_room_state(uuid) from public;
grant execute on function public.get_room_state(uuid) to authenticated;
