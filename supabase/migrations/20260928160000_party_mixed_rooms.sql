-- Mixed Party rooms (docs/COMPETITIVE_ROADMAP.md P8, with R3, R4 and R5):
-- some players are in the living room at the TV, others join from
-- somewhere else. Living-room phones stay controllers with no voice, since
-- everyone there can already hear each other. A player joining from
-- elsewhere gets the ordinary 3D table and voice, so they're at the table
-- too.
--
-- Only mixed rooms' voice is unlocked here. The screen's own microphone and
-- camera need a signed-in 18+ operator (V5, decision 11) and are not part
-- of this. Text chat stays off in party rooms.
--
-- Scope note: P8's between-game mini-game and native TV apps are separate
-- deliverables (R8), not in this migration.

alter table public.players
  add column party_remote boolean not null default false;

-- Where a player is sitting, chosen in the lobby before the game starts.
-- Only the seat's own holder decides, and only in a party room.
create or replace function public.set_party_remote(p_room_id uuid, p_remote boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
  v_room public.rooms;
begin
  if p_remote is null then raise exception 'INVALID_ARGUMENT'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not v_room.is_party then raise exception 'NOT_PARTY_ROOM'; end if;
  if v_room.status <> 'lobby' then raise exception 'INVALID_PHASE'; end if;
  v_player := private.ludo_caller_player_id(p_room_id);
  if v_player is null then raise exception 'SEAT_NOT_CONTROLLED'; end if;
  update public.players set party_remote = p_remote where id = v_player;
  perform private.ludo_broadcast_state(p_room_id);
end;
$$;
revoke execute on function public.set_party_remote(uuid, boolean) from public;
grant execute on function public.set_party_remote(uuid, boolean) to authenticated;

-- Redefines 20260928090000_party_screen.sql's version: a player joining a
-- party room from elsewhere can use voice. Living-room phones cannot: they
-- are in one room, and their audio would only echo.
create or replace function private.party_no_voice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.in_voice and not old.in_voice
    and (select is_party from public.rooms where id = new.room_id)
    and not new.party_remote then
    raise exception 'PARTY_ROOM';
  end if;
  return new;
end;
$$;
revoke execute on function private.party_no_voice() from public;

-- A seat that goes back to the living room leaves the call with it.
create or replace function private.party_remote_leaves_voice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.party_remote and not new.party_remote then
    new.in_voice := false;
  end if;
  return new;
end;
$$;
revoke execute on function private.party_remote_leaves_voice() from public;

create trigger party_remote_leaves_voice
before update of party_remote on public.players
for each row execute function private.party_remote_leaves_voice();

-- Redefines 20260928090000_party_screen.sql's version: call signalling in a
-- party room runs between two players who both joined from elsewhere, so it
-- never reaches the living room or the screen.
CREATE OR REPLACE FUNCTION public.send_webrtc_signal(p_room_id uuid, p_to_player_id uuid, p_signal jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from uuid;
begin
  v_from := private.ludo_caller_player_id(p_room_id);
  if v_from is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;
  if (select is_party from public.rooms where id = p_room_id)
    and not (
      (select party_remote from public.players where id = v_from)
      and (select party_remote from public.players where id = p_to_player_id)
    ) then
    raise exception 'PARTY_ROOM';
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
$function$;

-- Redefines 20260928130000_party_reconnect.sql's version: waiting two
-- minutes is for living-room phones, which lock and get put away. A player
-- who joined from elsewhere follows the ordinary takeover rules.
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
  if v_player.is_bot or v_player.status = 'bot' or v_player.auto_roll_enabled or v_player.party_remote
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

-- Redefines 20260928150000_party_defaults.sql's version: adds where each
-- player is sitting, so the phones and the screen can say so.
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
revoke execute on function private.ludo_room_state_json(uuid) from public;
