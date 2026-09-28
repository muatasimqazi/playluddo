-- Room rules (docs/COMPETITIVE_ROADMAP.md F0.2) and the first rule, an
-- extra roll when a pawn gets home (F1.5, decided on by default).
--
-- rooms.rules is the host's choice: set in the lobby, kept across rematches.
-- rooms.match_rules is a resolved copy frozen by start_match, and is the
-- only thing the engine reads, so a running match never changes rules
-- under the players: not when the host's choice changes, not when a
-- default changes in a later migration.
--
-- Rules only ever hold keys this file knows. Unknown keys are rejected by
-- set_room_rules and dropped by ludo_resolve_rules. The client mirror is
-- lib/board/types.ts (RoomRules, DEFAULT_ROOM_RULES) and
-- lib/board/rules.ts (resolveRoomRules, earnsBonusRoll).

alter table public.rooms
  add column rules jsonb not null default '{}'::jsonb,
  add column match_rules jsonb not null default '{}'::jsonb;

-- Matches already running when this deploys finish under the rules they
-- started with, which had no extra roll for getting home. Only the frozen
-- copy changes; the host's choice stays empty, so their next game gets the
-- current defaults.
update public.rooms set match_rules = '{"bonusRollOnFinish": false}'::jsonb where status = 'in_game';

create or replace function private.ludo_default_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"bonusRollOnFinish": true}'::jsonb;
$$;

revoke execute on function private.ludo_default_rules() from public;

-- Defaults, overlaid with whichever known keys the input sets.
create or replace function private.ludo_resolve_rules(p_rules jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select private.ludo_default_rules() || coalesce(
    (select jsonb_object_agg(key, value)
     from jsonb_each(case when jsonb_typeof(p_rules) = 'object' then p_rules else '{}'::jsonb end)
     where key in (select jsonb_object_keys(private.ludo_default_rules()))),
    '{}'::jsonb
  );
$$;

revoke execute on function private.ludo_resolve_rules(jsonb) from public;

-- PRD 4.2 plus F1.5: one bonus roll for a six, a capture, or (when the rule
-- is on) a pawn reaching home. Boolean by construction, so a roll that
-- qualifies more than one way still earns one bonus. A player's final pawn
-- never reaches this: ludo_perform_move takes the finished branch first.
drop function private.ludo_earns_bonus_roll(integer, jsonb);

create or replace function private.ludo_earns_bonus_roll(p_die_value integer, p_move jsonb, p_rules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_die_value = 6
    or jsonb_array_length(coalesce(p_move->'capturesPawnIds', '[]'::jsonb)) > 0
    or (
      (private.ludo_resolve_rules(p_rules)->>'bonusRollOnFinish')::boolean
      and coalesce((p_move->>'finishesPawn')::boolean, false)
    );
$$;

revoke execute on function private.ludo_earns_bonus_roll(integer, jsonb, jsonb) from public;

-- Host-only, lobby-only, same shape as set_room_game. Replaces the whole
-- choice; the client sends every key it shows.
create or replace function public.set_room_rules(p_room_id uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_room public.rooms; v_caller uuid;
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
  if v_room.rules is distinct from p_rules then
    update public.rooms set rules = p_rules where id = p_room_id;
    perform private.ludo_append_event(p_room_id, 'rules_changed', v_caller,
      jsonb_build_object('rules', private.ludo_resolve_rules(p_rules)));
    perform private.ludo_broadcast_state(p_room_id);
  end if;
  return private.ludo_room_state_json(p_room_id);
end;
$$;

revoke execute on function public.set_room_rules(uuid, jsonb) from public;
grant execute on function public.set_room_rules(uuid, jsonb) to authenticated;

-- Redefines 20260921020000_two_player_diagonal_seating.sql's version: the
-- host's rules are resolved and frozen for this match, and recorded on the
-- match_started event so a replay knows what was played.
CREATE OR REPLACE FUNCTION public.start_match(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  for v_player in select * from public.players where room_id = p_room_id loop
    insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
    select p_room_id, v_player.id, gs, 'nest', null
    from generate_series(0, case when v_room.game_type = 'ludo' then 3 else 0 end) as gs;
  end loop;

  select id into v_first_player_id from public.players where room_id = p_room_id order by seat_index asc limit 1;

  update public.rooms
  set status = 'in_game',
      turn_player_id = v_first_player_id,
      turn_phase = 'awaiting_roll',
      turn_deadline_at = private.ludo_next_turn_deadline(v_first_player_id),
      rolls_this_turn = 0,
      consecutive_sixes = 0,
      match_rules = private.ludo_resolve_rules(v_room.rules)
  where id = p_room_id;

  perform private.ludo_append_event(p_room_id, 'match_started', null,
    jsonb_build_object('rules', private.ludo_resolve_rules(v_room.rules)));
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('roomId', p_room_id);
end;
$function$;

-- Redefines 20260920020000_room_max_players.sql's version: adds the room's
-- resolved rules for the lobby to show.
CREATE OR REPLACE FUNCTION private.ludo_room_state_json(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'roomId', r.id, 'hostPlayerId', r.host_player_id, 'code', r.code, 'gameType', r.game_type,
    'status', r.status, 'paused', r.paused_at is not null, 'maxPlayers', r.max_players,
    'rules', private.ludo_resolve_rules(r.rules),
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

-- Redefines 20260928030000_two_player_ludo_ends_on_first_win.sql's version:
-- the bonus check reads the match's frozen rules.
CREATE OR REPLACE FUNCTION private.ludo_perform_move(p_room_id uuid, p_player_id uuid, p_pawn_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_winner_ids uuid[];
  v_player_count int;
begin
  select * into v_room from public.rooms where id = p_room_id;
  select color into v_mover_color from public.players where id = p_player_id;

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
    v_winner_ids := case
      when p_player_id = any(v_room.winner_ids) then v_room.winner_ids
      else array_append(v_room.winner_ids, p_player_id)
    end;
    select count(*) into v_player_count from public.players where room_id = p_room_id;

    perform private.ludo_append_event(
      p_room_id,
      'player_finished',
      p_player_id,
      jsonb_build_object('place', array_length(v_winner_ids, 1))
    );

    if (v_player_count = 2 and coalesce(array_length(v_winner_ids, 1), 0) >= 1)
      or coalesce(array_length(v_winner_ids, 1), 0) >= v_player_count then
      update public.rooms
      set status = 'summary',
          winner_ids = v_winner_ids,
          match_end_reason = 'completed',
          turn_phase = 'complete',
          turn_deadline_at = null,
          active_dice_value = null
      where id = p_room_id;

      perform private.ludo_append_event(
        p_room_id,
        'match_completed',
        v_winner_ids[1],
        jsonb_build_object('winnerId', v_winner_ids[1], 'placements', v_winner_ids)
      );
    else
      update public.rooms set winner_ids = v_winner_ids where id = p_room_id;
      perform private.ludo_advance_to_next_player(p_room_id);
    end if;
  else
    v_bonus := private.ludo_earns_bonus_roll(v_room.active_dice_value, v_move, v_room.match_rules);
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
$function$;
