-- Rush mode, the clock itself (docs/COMPETITIVE_ROADMAP.md F2.3):
-- starting it with the match, stopping it while the match is paused,
-- bounding the rule, reporting it to the table, and ending a timed match
-- that runs out while nobody is taking a turn.

-- Redefines the live version: matchMinutes is 0, 5 or 10.
CREATE OR REPLACE FUNCTION public.set_room_rules(p_room_id uuid, p_rules jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_room public.rooms; v_caller uuid; v_start int; v_win int;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  v_caller := private.ludo_caller_player_id(p_room_id);
  if v_caller is null or v_caller <> v_room.host_player_id then raise exception 'NOT_HOST'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  if p_rules is null
    or jsonb_typeof(p_rules) <> 'object'
    or exists (
      select 1 from jsonb_each(p_rules)
      where key not in (select jsonb_object_keys(private.ludo_default_rules()))
         or jsonb_typeof(value) <> jsonb_typeof(private.ludo_default_rules()->key)
    )
  then
    raise exception 'INVALID_RULES';
  end if;
  v_start := (private.ludo_resolve_rules(p_rules)->>'startOnBoard')::int;
  v_win := (private.ludo_resolve_rules(p_rules)->>'pawnsToWin')::int;
  if v_start not between 0 and 4 or v_win not between 1 and 4 then raise exception 'INVALID_RULES'; end if;
  if (private.ludo_resolve_rules(p_rules)->>'matchMinutes')::int not in (0, 5, 10) then raise exception 'INVALID_RULES'; end if;
  if v_room.rules is distinct from p_rules then
    update public.rooms set rules = p_rules where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'rules_changed', v_caller,
      jsonb_build_object('rules', private.ludo_resolve_rules(p_rules)));
    perform private.ludo_broadcast_state(p_room_id);
  end if;
  return private.ludo_room_state_json(p_room_id);
end;
$function$;
revoke execute on function public.set_room_rules(uuid, jsonb) from public;
grant execute on function public.set_room_rules(uuid, jsonb) to authenticated;

-- Redefines the live version: the clock starts with the match.
CREATE OR REPLACE FUNCTION public.start_match(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_start_on_board int := (private.ludo_resolve_rules((select rules from public.rooms where id = p_room_id))->>'startOnBoard')::int;

  v_room public.rooms;
  v_caller_player_id uuid;
  v_seat int;
  v_seat_count int;
  v_first_player_id uuid;
  v_player record;
  v_match_id uuid;
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

  -- For a 2-player room, join_room/fill_bot only ever seat the diagonal
  -- pair, so the v_seat_count >= 2 check above already means both of
  -- those (possibly non-{0,1}) seats are filled — nothing to bot-fill.
  -- Running the seat-range loop below unconditionally would be a real
  -- bug here: for a room actually seated at {1,3}, it would insert a
  -- phantom third bot at seat 0 (or 1), since that range still assumes
  -- every 2-player room uses seats {0,1}.
  if v_room.max_players <> 2 then
    for v_seat in 0..(v_room.max_players - 1) loop
      if not exists (select 1 from public.players where room_id = p_room_id and seat_index = v_seat) then
        insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
        values (p_room_id, v_seat, null, 'Bot ' || (v_seat + 1), private.ludo_color_for_seat(v_seat), 'bot', true);
      end if;
    end loop;
  end if;

  -- Quick mode (F2.1): some pieces can start on the board, at the entry
  -- square their colour comes out onto. Snakes & Ladders has one piece and
  -- its own way in, so it never starts on the board.
  for v_player in select * from public.players where room_id = p_room_id loop
    insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
    select p_room_id, v_player.id, gs,
      case when v_room.game_type = 'ludo' and gs < v_start_on_board then 'track' else 'nest' end,
      case when v_room.game_type = 'ludo' and gs < v_start_on_board then 0 end
    from generate_series(0, case when v_room.game_type = 'ludo' then 3 else 0 end) as gs;
  end loop;

  select id into v_first_player_id from public.players where room_id = p_room_id order by seat_index asc limit 1;

  -- Rush mode (F2.3): the clock starts with the match.
  update public.rooms set match_ends_at = case
      when (private.ludo_resolve_rules(v_room.rules)->>'matchMinutes')::int > 0
      then now() + make_interval(mins => (private.ludo_resolve_rules(v_room.rules)->>'matchMinutes')::int)
    end
  where id = p_room_id;

  insert into public.matches (room_id, game_type, rules)
  values (p_room_id, v_room.game_type, private.ludo_resolve_rules(v_room.rules))
  returning id into v_match_id;

  -- The dice seed for this match, committed to before the first roll.
  insert into private.match_dice (match_id, seed)
  values (v_match_id, extensions.gen_random_bytes(32));
  update public.matches
  set dice_commitment = (select encode(extensions.digest(seed, 'sha256'), 'hex')
                         from private.match_dice where match_id = v_match_id)
  where id = v_match_id;

  update public.rooms
  set status = 'in_game',
      turn_player_id = v_first_player_id,
      turn_phase = 'awaiting_roll',
      turn_deadline_at = private.ludo_next_turn_deadline(v_first_player_id),
      rolls_this_turn = 0,
      consecutive_sixes = 0,
      match_rules = private.ludo_resolve_rules(v_room.rules),
      current_match_id = v_match_id
  where id = p_room_id;

  -- The match's starting point, so its history can be read from events
  -- alone: who sat where, and which pawn belongs to whom.
  perform private.ludo_append_event(p_room_id, 'match_started', null, jsonb_build_object(
    'matchId', v_match_id,
    'rules', private.ludo_resolve_rules(v_room.rules),
    'diceProtocol', 'luddo-dice-v1',
    'diceCommitment', (select dice_commitment from public.matches where id = v_match_id),
    'seats', (select jsonb_agg(jsonb_build_object(
        'playerId', p.id, 'seatIndex', p.seat_index, 'color', p.color, 'isBot', p.is_bot
      ) order by p.seat_index) from public.players p where p.room_id = p_room_id),
    'pawns', (select jsonb_agg(jsonb_build_object(
        'pawnId', pw.id, 'playerId', pw.player_id, 'index', pw.pawn_index
      ) order by pw.player_id, pw.pawn_index) from public.pawns pw where pw.room_id = p_room_id)
  ));
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('roomId', p_room_id);
end;
$function$;

-- Redefines the live version: a paused match's clock stops with it.
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
      match_ends_at = case when match_ends_at is null then null else match_ends_at + (now() - paused_at) end,
      paused_at = null, paused_for_player_id = null
    where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'match_resumed', v_player_id, '{}'::jsonb);
  end if;
  perform private.ludo_broadcast_state(p_room_id);
  return private.ludo_room_state_json(p_room_id);
end; $function$;
revoke execute on function public.toggle_match_pause(uuid, boolean) from public;
grant execute on function public.toggle_match_pause(uuid, boolean) to authenticated;

-- Redefines the live version: so does a party table waiting for a phone.
CREATE OR REPLACE FUNCTION public.party_heartbeat(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    set paused_at = null, paused_for_player_id = null, turn_deadline_at = private.ludo_next_turn_deadline(v_player),
      match_ends_at = case when match_ends_at is null then null else match_ends_at + (now() - paused_at) end
    where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'match_resumed', v_player, jsonb_build_object('reason', 'reconnected'));
    perform private.ludo_broadcast_state(p_room_id);
  end if;
end;
$function$;

-- Redefines the live version: and one that gave up waiting.
CREATE OR REPLACE FUNCTION private.party_absence_expired(p_room_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_player uuid;
begin
  select paused_for_player_id into v_player from public.rooms where id = p_room_id;
  if v_player is null then return; end if;
  update public.players set status = 'bot' where id = v_player;
  update public.rooms set paused_at = null, paused_for_player_id = null, turn_deadline_at = now(),
    match_ends_at = case when match_ends_at is null then null else match_ends_at + (now() - paused_at) end
  where id = p_room_id;
  perform private.ludo_append_event(p_room_id, 'match_resumed', v_player, jsonb_build_object('reason', 'computer_took_over'));
  perform private.ludo_resolve_turn_timeout(p_room_id);
end;
$function$;
revoke execute on function private.party_absence_expired(uuid) from public;

-- Redefines the live version: the table is told when time runs out.
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
    'matchEndsAt', r.match_ends_at,
    'diceCommitment', (select m.dice_commitment from public.matches m where m.id = r.current_match_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name, 'color', p.color,
      'status', p.status, 'isBot', p.is_bot, 'missedDecisionCount', p.missed_decision_count,
      'level', p.level, 'testWalletBalance', p.test_wallet_balance, 'autoRollEnabled', p.auto_roll_enabled,
      'rematchReady', p.rematch_ready, 'inVoice', p.in_voice, 'partyRemote', p.party_remote,
      'hasCaptured', p.has_captured,
      'avatarId', coalesce((select u.raw_user_meta_data ->> 'avatar_id' from auth.users u where u.id = p.user_id), (array['fox','panda','owl','frog'])[p.seat_index + 1]),
      'country', coalesce((select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id), '')
    ) order by p.seat_index) from public.players p where p.room_id = r.id), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id), 'turnPlayerId', r.turn_player_id,
    'turnPhase', r.turn_phase, 'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value, 'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null then private.ludo_legal_moves(private.ludo_room_pawns_json(r.id), (select color from public.players where id = r.turn_player_id), r.active_dice_value, r.match_rules, (select has_captured from public.players where id = r.turn_player_id)) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb), 'matchEndReason', r.match_end_reason,
    'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$function$;
revoke execute on function private.ludo_room_state_json(uuid) from public;

-- Redefines the live version: a timed match ends even if nobody is playing.
CREATE OR REPLACE FUNCTION public.sweep_expired_turns()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- A timed match whose clock ran out while nobody was taking a turn.
  for v_room_id in select id from public.rooms
    where status = 'in_game' and paused_at is null and match_ends_at is not null and match_ends_at <= now()
    for update skip locked loop
    perform private.ludo_end_match_on_time(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
  for v_room_id in select id from public.rooms where status = 'in_game' and paused_for_player_id is not null and paused_at <= now() - interval '2 minutes' for update skip locked loop
    perform private.party_absence_expired(v_room_id);
    perform private.ludo_check_abandonment(v_room_id);
    perform private.ludo_broadcast_state(v_room_id);
  end loop;
end;
$function$;
revoke execute on function public.sweep_expired_turns() from public;
