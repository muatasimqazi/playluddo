-- Joining from a shared room link (/room?id=<uuid>) without the room code.
-- The link only carries the room id, and the room page could only *claim* a
-- seat someone already held — so a friend opening the link just hit an
-- error. These let the room page show the invite and seat them by id.
-- Knowing the room's UUID is the credential here, the same as knowing its
-- code: both come only from the host's invite.

-- What the invite screen shows before joining. Readable by any signed-in
-- (including anonymous) caller who has the id — rooms' own RLS only lets
-- seated players read them.
create or replace function public.room_invite(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_room from public.rooms where id = p_room_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  return jsonb_build_object(
    'status', v_room.status,
    'gameType', v_room.game_type,
    'maxPlayers', v_room.max_players,
    'seatsTaken', (select count(*) from public.players where room_id = p_room_id),
    'hostName', (select display_name from public.players where id = v_room.host_player_id),
    'isSeated', exists (select 1 from public.players where room_id = p_room_id and user_id = (select auth.uid()))
  );
end;
$$;
revoke execute on function public.room_invite(uuid) from public;
revoke execute on function public.room_invite(uuid) from anon;
grant execute on function public.room_invite(uuid) to authenticated;

-- Seat the caller by room id: same rules as join_room (lobby only, seat
-- assignment, 2-player diagonal pairing, idempotent for someone already
-- seated), just looked up by id instead of code.
create or replace function public.join_room_by_id(p_room_id uuid, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select code into v_code from public.rooms where id = p_room_id;
  if v_code is null then raise exception 'ROOM_NOT_FOUND'; end if;
  return public.join_room(v_code, coalesce(nullif(btrim(p_display_name), ''), 'Player'));
end;
$$;
revoke execute on function public.join_room_by_id(uuid, text) from public;
revoke execute on function public.join_room_by_id(uuid, text) from anon;
grant execute on function public.join_room_by_id(uuid, text) to authenticated;
