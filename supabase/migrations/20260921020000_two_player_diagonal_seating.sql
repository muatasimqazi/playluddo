-- A 2-player room let its host and guest pick any color, but only ever
-- assigned/validated seats 0 and 1 (red, green) — adjacent corners on the
-- board (components/arena/boardLayout.ts BASE_AREA: red=top-left,
-- green=top-right, yellow=bottom-right, blue=bottom-left). This lets a
-- 2-player room use ANY of the 4 colors, with the second seat always the
-- diagonal partner of whichever seat the first player is already using
-- (0<->2 red/yellow, 1<->3 green/blue), so two players always end up
-- seated across the board from each other. 3-4 player rooms are unchanged.
create or replace function private.ludo_valid_seat(p_room_id uuid, p_seat_index int, p_ignore_player_id uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_max int; v_other_seat int;
begin
  if p_seat_index < 0 or p_seat_index > 3 then return false; end if;
  select max_players into v_max from public.rooms where id = p_room_id;
  if v_max <> 2 then return p_seat_index < v_max; end if;
  select seat_index into v_other_seat from public.players
    where room_id = p_room_id and (p_ignore_player_id is null or id <> p_ignore_player_id)
    limit 1;
  if v_other_seat is null then return true; end if;
  return p_seat_index = (v_other_seat + 2) % 4;
end;
$$;
revoke execute on function private.ludo_valid_seat(uuid, int, uuid) from public;

create or replace function public.join_room(p_code text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms; v_existing_player_id uuid; v_seat_index int; v_other_seat int;
  v_player_id uuid;
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
  if v_room.max_players = 2 then
    select seat_index into v_other_seat from public.players where room_id = v_room.id limit 1;
    if v_other_seat is null then
      v_seat_index := 0;
    else
      v_seat_index := (v_other_seat + 2) % 4;
      if exists (select 1 from public.players where room_id = v_room.id and seat_index = v_seat_index) then
        v_seat_index := null;
      end if;
    end if;
  else
    select seat into v_seat_index from generate_series(0, v_room.max_players - 1) seat
      where not exists (
        select 1 from public.players p where p.room_id = v_room.id and p.seat_index = seat
      ) order by seat limit 1;
  end if;
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

  if not private.ludo_valid_seat(p_room_id, p_seat_index) then
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
      consecutive_sixes = 0
  where id = p_room_id;

  perform private.ludo_append_event(p_room_id, 'match_started', null, '{}'::jsonb);
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('roomId', p_room_id);
end;
$$;

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
  if not private.ludo_valid_seat(p_room_id, v_seat_index, v_player_id) then raise exception 'INVALID_SEAT'; end if;
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
