-- The home page lets a host choose 2/3/4 players, but that choice was never
-- persisted: start_match unconditionally bot-filled every empty seat up to
-- 4 regardless. This adds a real per-room seat limit, defaulting to 4 so
-- every existing room/test keeps its current behavior unless it explicitly
-- opts into a smaller table.
alter table public.rooms add column max_players int not null default 4
  check (max_players between 2 and 4);

-- Adding a parameter changes the signature, so the old two-arg overload
-- (20260919050000_team_active_room.sql) must be dropped first or PostgREST
-- ends up with two ambiguous candidates.
drop function if exists public.create_room(text, uuid);

create or replace function public.create_room(p_display_name text, p_team_id uuid default null, p_max_players int default 4)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
  v_player_id uuid;
  v_team_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  if p_max_players not in (2, 3, 4) then
    raise exception 'INVALID_PLAYER_COUNT';
  end if;

  if p_team_id is not null then
    select t.id into v_team_id
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
    where t.id = p_team_id and tm.user_id = (select auth.uid());
    if v_team_id is null then
      raise exception 'NOT_TEAM_MEMBER';
    end if;
  end if;

  v_code := private.ludo_generate_room_code();

  insert into public.rooms (code, status, team_id, max_players)
  values (v_code, 'lobby', v_team_id, p_max_players)
  returning id into v_room_id;

  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (v_room_id, 0, (select auth.uid()), p_display_name, private.ludo_color_for_seat(0), 'connected', false)
  returning id into v_player_id;

  update public.rooms set host_player_id = v_player_id where id = v_room_id;

  perform private.ludo_broadcast_state(v_room_id);

  return jsonb_build_object('roomId', v_room_id, 'code', v_code, 'playerId', v_player_id);
end;
$$;

revoke execute on function public.create_room(text, uuid, int) from public;
grant execute on function public.create_room(text, uuid, int) to authenticated;
revoke execute on function public.create_room(text, uuid, int) from anon;

create or replace function public.join_room(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms; v_existing_player_id uuid; v_seat_index int; v_player_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_room from public.rooms where code = upper(p_code) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  select id into v_existing_player_id from public.players
    where room_id = v_room.id and user_id = (select auth.uid());
  if v_existing_player_id is not null then
    return jsonb_build_object('roomId', v_room.id, 'code', v_room.code, 'playerId', v_existing_player_id);
  end if;
  select seat into v_seat_index from generate_series(0, v_room.max_players - 1) seat
    where not exists (
      select 1 from public.players p where p.room_id = v_room.id and p.seat_index = seat
    ) order by seat limit 1;
  if v_seat_index is null then raise exception 'ROOM_FULL'; end if;
  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (v_room.id, v_seat_index, (select auth.uid()), p_display_name,
    private.ludo_color_for_seat(v_seat_index), 'connected', false)
  returning id into v_player_id;
  perform private.ludo_broadcast_state(v_room.id);
  return jsonb_build_object('roomId', v_room.id, 'code', v_room.code, 'playerId', v_player_id);
end;
$$;

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

  if p_seat_index < 0 or p_seat_index >= v_room.max_players then
    raise exception 'INVALID_SEAT';
  end if;

  if exists (select 1 from public.players where room_id = p_room_id and seat_index = p_seat_index) then
    raise exception 'SEAT_TAKEN';
  end if;

  insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
  values (p_room_id, p_seat_index, null, 'Bot ' || (p_seat_index + 1), private.ludo_color_for_seat(p_seat_index), 'bot', true)
  returning id into v_player_id;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('playerId', v_player_id);
end;
$$;

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

  for v_seat in 0..(v_room.max_players - 1) loop
    if not exists (select 1 from public.players where room_id = p_room_id and seat_index = v_seat) then
      insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
      values (p_room_id, v_seat, null, 'Bot ' || (v_seat + 1), private.ludo_color_for_seat(v_seat), 'bot', true);
    end if;
  end loop;

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
      consecutive_sixes = 0
  where id = p_room_id;

  perform private.ludo_append_event(p_room_id, 'match_started', null, '{}'::jsonb);
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('roomId', p_room_id);
end;
$$;

create or replace function public.set_room_max_players(p_room_id uuid, p_max_players int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_caller uuid; v_seated int;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  v_caller := private.ludo_caller_player_id(p_room_id);
  if v_caller is null or v_caller <> v_room.host_player_id then raise exception 'NOT_HOST'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  if p_max_players not in (2, 3, 4) then raise exception 'INVALID_PLAYER_COUNT'; end if;
  select count(*) into v_seated from public.players where room_id = p_room_id;
  if p_max_players < v_seated then raise exception 'TOO_MANY_SEATED'; end if;
  if v_room.max_players <> p_max_players then
    update public.rooms set max_players = p_max_players where id = p_room_id;
    perform private.ludo_broadcast_state(p_room_id);
  end if;
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.set_room_max_players(uuid, int) from public;
grant execute on function public.set_room_max_players(uuid, int) to authenticated;

create or replace function public.set_player_color(p_room_id uuid, p_color text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms; v_player_id uuid; v_seat_index int;
begin
  if p_color not in ('red', 'green', 'yellow', 'blue') then raise exception 'INVALID_COLOR'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  v_player_id := private.ludo_caller_player_id(p_room_id);
  if v_player_id is null then raise exception 'UNAUTHENTICATED'; end if;
  v_seat_index := case p_color when 'red' then 0 when 'green' then 1
    when 'yellow' then 2 when 'blue' then 3 end;
  if v_seat_index >= v_room.max_players then raise exception 'INVALID_SEAT'; end if;
  if exists (
    select 1 from public.players
    where room_id = p_room_id and color = p_color and id <> v_player_id
  ) then raise exception 'COLOR_TAKEN'; end if;
  update public.players set color = p_color, seat_index = v_seat_index
    where id = v_player_id;
  perform private.ludo_broadcast_state(p_room_id);
  return private.ludo_room_state_json(p_room_id);
end;
$$;

create or replace function private.ludo_room_state_json(p_room_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'roomId', r.id, 'hostPlayerId', r.host_player_id, 'code', r.code, 'gameType', r.game_type,
    'status', r.status, 'paused', r.paused_at is not null, 'maxPlayers', r.max_players,
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
$$;
