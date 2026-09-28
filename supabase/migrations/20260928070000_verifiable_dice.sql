-- Dice players can verify (docs/COMPETITIVE_ROADMAP.md F1.2; Section 15, R2).
--
-- Protocol luddo-dice-v1:
--   * When a match starts, the server draws a secret 32-byte seed and
--     publishes only commitment = hex(SHA-256(seed)): on the match_started
--     event and in the room state, before the first roll.
--   * Roll k (0-based: the k-th dice_rolled event of the match, in event
--     order) is derived from the seed. For block b = 0, 1, 2, ...:
--         H = HMAC-SHA256(key = seed,
--                         message = UTF-8 "luddo-dice-v1:<matchId>:<k>:<b>")
--     Scan H's 32 bytes in order; the first byte below 252 gives the face
--     1 + byte % 6 (the unbiased mapping from private.die_face_from_byte).
--     A block with no usable byte moves on to the next b.
--   * When the match ends, however it ends, the seed is revealed through
--     get_dice_proof, and anyone at the table can recompute every roll.
--
-- What this proves: the rolls followed from a seed fixed before the first
-- roll, so they weren't changed during or after play. It does not prove how
-- the seed was chosen, or that the server couldn't foresee the rolls; the
-- player-facing copy must say no more than that (lib/presentation/diceProof.ts).
--
-- Matches already running when this deploys, and any match without a seed,
-- keep rolling with private.roll_die() and have no proof.

-- Seeds live apart from everything clients can reach. roll_count is the
-- next roll's index; a rolled-back transaction rolls it back too, so
-- indices stay consecutive.
create table private.match_dice (
  match_id uuid primary key references public.matches(id) on delete cascade,
  seed bytea not null check (length(seed) = 32),
  roll_count int not null default 0
);
revoke all on private.match_dice from public, anon, authenticated;

alter table public.matches add column dice_commitment text;

-- The protocol itself, pure: the face for roll p_index of a match. Split out
-- so tests can check it against the browser's copy
-- (lib/presentation/diceProof.ts) with fixed inputs.
create or replace function private.dice_face(p_seed bytea, p_match_id uuid, p_index int)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_block int := 0;
  v_hash bytea;
  v_face int;
begin
  loop
    v_hash := extensions.hmac(
      convert_to(format('luddo-dice-v1:%s:%s:%s', p_match_id, p_index, v_block), 'UTF8'),
      p_seed,
      'sha256'
    );
    for i in 0..31 loop
      v_face := private.die_face_from_byte(get_byte(v_hash, i));
      if v_face is not null then return v_face; end if;
    end loop;
    v_block := v_block + 1;
  end loop;
end;
$$;
revoke execute on function private.dice_face(bytea, uuid, int) from public;

-- One die for the room's current match: the next index, from its seed.
create or replace function private.roll_match_die(p_room_id uuid)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_match_id uuid;
  v_seed bytea;
  v_index int;
begin
  select current_match_id into v_match_id from public.rooms where id = p_room_id;
  update private.match_dice
  set roll_count = roll_count + 1
  where match_id = v_match_id
  returning seed, roll_count - 1 into v_seed, v_index;
  if v_seed is null then
    return private.roll_die();
  end if;
  return private.dice_face(v_seed, v_match_id, v_index);
end;
$$;
revoke execute on function private.roll_match_die(uuid) from public;

-- The latest match's dice for the players at the table. The seed is null
-- until the match has ended. Rolls are the match's dice_rolled events in
-- order, which is what the indices above count.
create or replace function public.get_dice_proof(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_match public.matches;
begin
  if not private.ludo_is_seated_in_room(p_room_id) then raise exception 'ROOM_NOT_FOUND'; end if;
  select m.* into v_match
  from public.matches m join public.rooms r on r.current_match_id = m.id
  where r.id = p_room_id;
  if v_match.id is null or v_match.dice_commitment is null then return null; end if;
  return jsonb_build_object(
    'protocol', 'luddo-dice-v1',
    'matchId', v_match.id,
    'commitment', v_match.dice_commitment,
    'seed', case when v_match.ended_at is not null
              then (select encode(seed, 'hex') from private.match_dice where match_id = v_match.id) end,
    'rolls', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence', e.sequence,
        'playerId', e.player_id,
        'dieValue', (e.payload->>'dieValue')::int
      ) order by e.sequence)
      from public.match_events e
      where e.match_id = v_match.id and e.event_type = 'dice_rolled'
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.get_dice_proof(uuid) from public;
grant execute on function public.get_dice_proof(uuid) to authenticated;

-- Redefines 20260928050000_match_stats.sql's version: draws the seed and
-- publishes its commitment on match_started.
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

  for v_player in select * from public.players where room_id = p_room_id loop
    insert into public.pawns (room_id, player_id, pawn_index, state, path_index)
    select p_room_id, v_player.id, gs, 'nest', null
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

-- Redefines 20260928020000_unbiased_dice.sql's version: Ludo rolls come
-- from the match's seed.
create or replace function private.ludo_perform_ludo_roll(p_room_id uuid, p_player_id uuid)
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

  v_die_value := private.roll_match_die(p_room_id);
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

revoke execute on function private.ludo_perform_ludo_roll(uuid, uuid) from public;

-- Redefines 20260928020000_unbiased_dice.sql's version: so do Snakes &
-- Ladders rolls.
create or replace function private.ludo_perform_roll(p_room_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if v_room.status <> 'in_game' then raise exception 'INVALID_PHASE'; end if;
  if v_room.game_type = 'ludo' then
    return private.ludo_perform_ludo_roll(p_room_id, p_player_id);
  end if;
  return private.snakes_apply_roll(p_room_id, p_player_id, private.roll_match_die(p_room_id));
end;
$$;

-- Redefines 20260928040000_room_rules.sql's version: the room state carries
-- the current match and its dice commitment, so a device can remember the
-- commitment it saw before play.
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
    'matchId', r.current_match_id,
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
