-- Quick mode (docs/COMPETITIVE_ROADMAP.md F2.1): a shorter game. Two rules
-- do the work, and both are ordinary room rules (F0.2) rather than a mode
-- of their own, so the house rules panel can combine them later (F2.4):
--
--   startOnBoard  how many pieces begin on the board instead of in base
--   pawnsToWin    how many pieces have to get home to win
--
-- "Quick" is the preset that sets them to 1 and 2. Defaults keep the
-- classic game exactly as it was.

create or replace function private.ludo_default_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"bonusRollOnFinish": true, "startOnBoard": 0, "pawnsToWin": 4}'::jsonb;
$$;

-- Redefines 20260928040000_room_rules.sql's version: the numbers are
-- bounded, not just typed.
create or replace function public.set_room_rules(p_room_id uuid, p_rules jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

-- How many pieces have to get home, from the match's own rules.
create or replace function private.ludo_is_match_won(p_pawns jsonb, p_color text, p_rules jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select count(*) >= (private.ludo_resolve_rules(p_rules)->>'pawnsToWin')::int
  from jsonb_array_elements(p_pawns) as pawn
  where pawn->>'color' = p_color and pawn->>'state' = 'finished';
$$;
revoke execute on function private.ludo_is_match_won(jsonb, text, jsonb) from public;

-- Redefines 20260913222114_rls_policies.sql's version: the classic rules,
-- for any caller that has no match rules to hand.
create or replace function private.ludo_is_match_won(p_pawns jsonb, p_color text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.ludo_is_match_won(p_pawns, p_color, private.ludo_default_rules());
$$;

-- Redefines the live version: the win check reads this match's rules.
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
  v_won := private.ludo_is_match_won(v_new_pawns, v_mover_color, v_room.match_rules);

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

-- Redefines the live version: pieces can start on the board.
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
