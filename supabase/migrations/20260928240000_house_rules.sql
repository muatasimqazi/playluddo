-- The house rules panel's server half (docs/COMPETITIVE_ROADMAP.md F2.4,
-- decision 14): named presets, a turn-timer rule, and an allow-list the
-- server enforces so hosts can only pick combinations whose edge cases are
-- covered by fixtures in both engines.
--
-- The allow-list is data, so adding a combination needs no client release.
--
-- Launch list, as decided: the four presets, plus a single change to
-- Classic — blockades on, the extra roll off, or a different turn timer.
--
-- The match clock (F2.3) and the two Snakes & Ladders rules (F2.6) sit
-- outside the list. They don't interact with the Ludo combinations above,
-- and each arrived with its own fixtures, so they combine freely.

create or replace function private.ludo_default_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4,
           "captureToEnterHome": false, "snakesAnyRollToStart": false, "snakesBounceBack": false,
           "matchMinutes": 0, "blockades": false, "turnSeconds": 15}'::jsonb;
$$;

-- The named sets of rules a host starts from.
create or replace function private.ludo_rule_presets()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'classic', '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4, "captureToEnterHome": false, "blockades": false, "turnSeconds": 15}'::jsonb,
    'quick',   '{"bonusRollOnFinish": true, "startOnBoard": 1, "pawnsToWin": 2, "captureToEnterHome": false, "blockades": false, "turnSeconds": 15}'::jsonb,
    'master',  '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4, "captureToEnterHome": true,  "blockades": false, "turnSeconds": 15}'::jsonb,
    'family',  '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4, "captureToEnterHome": false, "blockades": false, "turnSeconds": 30}'::jsonb
  );
$$;
revoke execute on function private.ludo_rule_presets() from public;
grant execute on function private.ludo_rule_presets() to authenticated;

-- Every combination a host may choose: the presets, and Classic with one
-- thing changed.
create or replace function private.ludo_allowed_rule_sets()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_agg(value) from (
    select value from jsonb_each(private.ludo_rule_presets())
    union all
    select private.ludo_rule_presets()->'classic' || change
    from jsonb_array_elements(jsonb_build_array(
      '{"blockades": true}'::jsonb,
      '{"bonusRollOnFinish": false}'::jsonb,
      '{"turnSeconds": 10}'::jsonb,
      '{"turnSeconds": 30}'::jsonb
    )) change
  ) sets;
$$;
revoke execute on function private.ludo_allowed_rule_sets() from public;
grant execute on function private.ludo_allowed_rule_sets() to authenticated;

-- The keys the allow-list governs. The rest are independent of them.
create or replace function private.ludo_combination_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['bonusRollOnFinish', 'startOnBoard', 'pawnsToWin', 'captureToEnterHome', 'blockades', 'turnSeconds'];
$$;
revoke execute on function private.ludo_combination_keys() from public;

create or replace function private.ludo_rules_allowed(p_rules jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(private.ludo_allowed_rule_sets()) allowed
    where (
      select jsonb_object_agg(key, value)
      from jsonb_each(private.ludo_resolve_rules(p_rules))
      where key = any(private.ludo_combination_keys())
    ) = allowed
  );
$$;
revoke execute on function private.ludo_rules_allowed(jsonb) from public;
grant execute on function private.ludo_rules_allowed(jsonb) to authenticated;

-- Redefines the live version: the turn timer is a rule, and combinations
-- outside the allow-list are refused.
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
  if (private.ludo_resolve_rules(p_rules)->>'turnSeconds')::int not in (10, 15, 30) then raise exception 'INVALID_RULES'; end if;
  if not private.ludo_rules_allowed(p_rules) then raise exception 'RULES_NOT_ALLOWED'; end if;
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

-- Redefines the live version: the turn timer comes from the rules, so there
-- is one source for it. rooms.party_turn_seconds is left in place but no
-- longer read.
CREATE OR REPLACE FUNCTION private.ludo_next_turn_deadline(p_player_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when private.ludo_is_bot_controlled(p_player_id) then now() + case
      when exists (select 1 from public.players p join public.rooms r on r.id = p.room_id
        where p.id = p_player_id and r.game_type = 'snakes_and_ladders')
      then interval '5.5 seconds' else interval '2 seconds' end
    else now() + make_interval(secs => coalesce((
      select (private.ludo_resolve_rules(coalesce(r.match_rules, r.rules))->>'turnSeconds')::int
      from public.players p join public.rooms r on r.id = p.room_id where p.id = p_player_id), 15))
  end;
$function$;
revoke execute on function private.ludo_next_turn_deadline(uuid) from public;

-- Redefines the live version: a party table's 30-second turns are its rules.
CREATE OR REPLACE FUNCTION public.create_party_room(p_game_type text DEFAULT 'ludo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room_id uuid;
  v_code text;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_game_type is null or p_game_type not in ('ludo', 'snakes_and_ladders') then
    raise exception 'INVALID_GAME_TYPE';
  end if;
  v_code := private.ludo_generate_room_code();
  insert into public.rooms (code, status, max_players, game_type, is_party, party_turn_seconds, rules)
  values (v_code, 'lobby', 4, p_game_type, true, 30, '{"turnSeconds": 30}'::jsonb)
  returning id into v_room_id;
  insert into public.room_displays (room_id, user_id) values (v_room_id, (select auth.uid()));
  return jsonb_build_object('roomId', v_room_id, 'code', v_code);
end;
$function$;
revoke execute on function public.create_party_room(text) from public;
grant execute on function public.create_party_room(text) to authenticated;

-- Redefines the live version: the party turn length is read from the rules.
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
    'isParty', r.is_party, 'partyLocked', r.party_locked,
    'partyTurnSeconds', (private.ludo_resolve_rules(coalesce(r.match_rules, r.rules))->>'turnSeconds')::int,
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
