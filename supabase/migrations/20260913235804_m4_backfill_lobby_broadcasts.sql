-- Bug fix, found by an actual browser playtest (M4), not by any pgTAP or
-- parity test: create_room/join_room/fill_bot were all written in M2,
-- before private.ludo_broadcast_state existed (M3). Every function built
-- after that point calls it; these three never got backfilled. Every
-- pgTAP test up to now only asserted database state after a call — none
-- exercised "does a subscribed client actually get told" — so this shipped
-- silently: a lobby's other players would never see a join or a bot fill
-- without manually refreshing. Confirmed via a real subscribed client and
-- WebSocket frame inspection that no `state_updated` broadcast was sent
-- after `fill_bot`, even though the underlying row was correctly written.

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

  perform private.ludo_broadcast_state(v_room_id);

  return jsonb_build_object('roomId', v_room_id, 'code', v_code, 'playerId', v_player_id);
end;
$$;

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
    -- Idempotent re-join: nothing changed, so nothing to broadcast.
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
