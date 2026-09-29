-- Party Mode, P2: the VIP role moves on when the VIP leaves
-- (docs/COMPETITIVE_ROADMAP.md Section 6).
--
-- The first person to sit at a party room is its VIP: they pick the game
-- and start it (20260928090000_party_screen.sql). A lobby has no other
-- sign of who's still there, so phones in a party lobby send a heartbeat
-- every 10 seconds. When the VIP hasn't been seen for 30 seconds, the next
-- heartbeat hands the role to the lowest-numbered seat that has, so the
-- table never waits on someone who's gone. Computers never become VIP.

create or replace function private.party_reassign_vip(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_next uuid;
begin
  -- Locked, so two heartbeats arriving together can't both hand it over.
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not v_room.is_party or v_room.status <> 'lobby' then return; end if;
  if v_room.host_player_id is not null and exists (
    select 1 from public.players
    where id = v_room.host_player_id and last_seen_at >= now() - interval '30 seconds'
  ) then
    return;
  end if;
  select id into v_next from public.players
  where room_id = p_room_id
    and not is_bot
    and id is distinct from v_room.host_player_id
    and last_seen_at >= now() - interval '30 seconds'
  order by seat_index
  limit 1;
  if v_next is null then return; end if;
  update public.rooms set host_player_id = v_next where id = p_room_id;
  perform private.ludo_append_event(p_room_id, 'vip_changed', v_next, '{}'::jsonb);
  perform private.ludo_broadcast_state(p_room_id);
end;
$$;
revoke execute on function private.party_reassign_vip(uuid) from public;

-- "Still here", from a phone in a party lobby. A no-op anywhere else.
create or replace function public.party_heartbeat(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  v_player := private.ludo_caller_player_id(p_room_id);
  if v_player is null then raise exception 'SEAT_NOT_CONTROLLED'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and is_party and status = 'lobby') then
    return;
  end if;
  update public.players set last_seen_at = now() where id = v_player;
  perform private.party_reassign_vip(p_room_id);
end;
$$;
revoke execute on function public.party_heartbeat(uuid) from public;
grant execute on function public.party_heartbeat(uuid) to authenticated;
