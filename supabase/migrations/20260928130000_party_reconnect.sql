-- Party Mode, P5 (docs/COMPETITIVE_ROADMAP.md Section 6): phones lock and
-- get put away far more often at a party. When it's a player's turn and
-- their phone has gone quiet, the table waits for them for up to two
-- minutes instead of handing the seat to a computer; their phone coming
-- back resumes it, and only after two minutes does a computer take over.
--
-- Phones send party_heartbeat every 10 seconds in the lobby and now during
-- the game too, so last_seen_at is a live signal in party rooms (elsewhere
-- it still moves only when a player acts). A phone is gone after 25 seconds
-- without one: two missed beats.
--
-- Limits: only the player whose turn it is can hold up the table, so two
-- absences never stack; each player can do so 3 times a match, after which
-- the normal takeover applies. The sweep expires a wait on its own, since
-- it skips paused rooms otherwise.

alter table public.rooms
  add column paused_for_player_id uuid references public.players(id) on delete set null;

-- Pauses the table for its turn player if their phone is gone. True if it did.
create or replace function private.party_pause_for_absence(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_player public.players;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not coalesce(v_room.is_party, false) or v_room.paused_at is not null or v_room.turn_player_id is null then
    return false;
  end if;
  select * into v_player from public.players where id = v_room.turn_player_id;
  if v_player.is_bot or v_player.status = 'bot' or v_player.auto_roll_enabled
    or now() - v_player.last_seen_at <= interval '25 seconds' then
    return false;
  end if;
  if (select count(*) from public.match_events
      where room_id = p_room_id and match_id = v_room.current_match_id and player_id = v_player.id
        and event_type = 'match_paused' and payload->>'reason' = 'disconnect') >= 3 then
    return false;
  end if;
  update public.rooms set paused_at = now(), paused_for_player_id = v_player.id where id = p_room_id;
  perform private.ludo_append_event(p_room_id, 'match_paused', v_player.id, jsonb_build_object('reason', 'disconnect'));
  return true;
end;
$$;
revoke execute on function private.party_pause_for_absence(uuid) from public;

-- Two minutes on: a computer takes the seat and plays on. The player can
-- still reclaim it later, as anywhere.
create or replace function private.party_absence_expired(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  select paused_for_player_id into v_player from public.rooms where id = p_room_id;
  if v_player is null then return; end if;
  update public.players set status = 'bot' where id = v_player;
  update public.rooms set paused_at = null, paused_for_player_id = null, turn_deadline_at = now() where id = p_room_id;
  perform private.ludo_append_event(p_room_id, 'match_resumed', v_player, jsonb_build_object('reason', 'computer_took_over'));
  perform private.ludo_resolve_turn_timeout(p_room_id);
end;
$$;
revoke execute on function private.party_absence_expired(uuid) from public;

-- Redefines 20260919020000_pause_matches.sql's version: a party table
-- waits for a missing phone before any turn times out, and a wait expires.
create or replace function public.sweep_expired_turns()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_room_id uuid;
begin
  for v_room_id in select id from public.rooms where status = 'in_game' and paused_at is null and turn_deadline_at is not null and turn_deadline_at <= now() for update skip locked loop
    if private.party_pause_for_absence(v_room_id) then
      perform private.ludo_broadcast_state(v_room_id);
      continue;
    end if;
    perform private.ludo_resolve_turn_timeout(v_room_id);
    perform private.ludo_check_abandonment(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
  for v_room_id in select id from public.rooms where status = 'in_game' and paused_for_player_id is not null and paused_at <= now() - interval '2 minutes' for update skip locked loop
    perform private.party_absence_expired(v_room_id);
    perform private.ludo_check_abandonment(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
end;
$$;
revoke execute on function public.sweep_expired_turns() from public;

-- Redefines 20260928100000_party_vip.sql's version: phones keep beating
-- during the game, and the phone a table is waiting for resumes it.
create or replace function public.party_heartbeat(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_room public.rooms;
begin
  v_player := private.ludo_caller_player_id(p_room_id);
  if v_player is null then raise exception 'SEAT_NOT_CONTROLLED'; end if;
  select * into v_room from public.rooms where id = p_room_id and is_party for update;
  if not found or v_room.status not in ('lobby', 'in_game') then
    return;
  end if;
  update public.players set last_seen_at = now() where id = v_player;
  if v_room.status = 'lobby' then
    perform private.party_reassign_vip(p_room_id);
  elsif v_room.paused_for_player_id = v_player then
    update public.rooms
    set paused_at = null, paused_for_player_id = null, turn_deadline_at = private.ludo_next_turn_deadline(v_player)
    where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'match_resumed', v_player, jsonb_build_object('reason', 'reconnected'));
    perform private.ludo_broadcast_state(p_room_id);
  end if;
end;
$$;

-- Redefines 20260919020000_pause_matches.sql's version: resuming also
-- ends a wait for a phone (the VIP can carry on without them), with that
-- turn restarted in full.
CREATE OR REPLACE FUNCTION public.toggle_match_pause(p_room_id uuid, p_paused boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    update public.rooms set turn_deadline_at = case
        when paused_for_player_id is not null then private.ludo_next_turn_deadline(turn_player_id)
        when turn_deadline_at is null then null
        else turn_deadline_at + (now() - paused_at) end,
      paused_at = null, paused_for_player_id = null
    where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'match_resumed', v_player_id, '{}'::jsonb);
  end if;
  perform private.ludo_broadcast_state(p_room_id);
  return private.ludo_room_state_json(p_room_id);
end; $function$;

-- Redefines 20260928090000_party_screen.sql's version: adds who the table
-- is waiting for, and since when.
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
    'isParty', r.is_party,
    'diceCommitment', (select m.dice_commitment from public.matches m where m.id = r.current_match_id),
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
$function$;
