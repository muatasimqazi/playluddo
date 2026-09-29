-- Call signalling in a mixed party room goes to the one seat it's meant for
-- (docs/COMPETITIVE_ROADMAP.md P8, requirement R4: the screen receives the
-- public table view and game events, never call signalling).
--
-- 20260928160000_party_mixed_rooms.sql let two players who joined from
-- elsewhere set up a call, but signals still went to the shared room topic,
-- which the living room's screen is subscribed to. Offer and answer carry
-- IP candidates, so they now go to a topic only the recipient can read.
-- Ordinary rooms keep the room topic: they have no screen.

create or replace function private.ludo_player_id_from_topic(p_topic text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic is null or p_topic !~ '^player:' then return null; end if;
  return substring(p_topic from 8)::uuid;
exception when others then
  return null;
end;
$$;
revoke execute on function private.ludo_player_id_from_topic(text) from public;
grant execute on function private.ludo_player_id_from_topic(text) to authenticated;

create or replace function private.ludo_controls_player(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players
    where id = p_player_id and user_id = (select auth.uid())
  );
$$;
revoke execute on function private.ludo_controls_player(uuid) from public;
grant execute on function private.ludo_controls_player(uuid) to authenticated;

create policy "players receive their own call signals"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and private.ludo_player_id_from_topic((select realtime.topic())) is not null
  and (select private.ludo_controls_player(private.ludo_player_id_from_topic((select realtime.topic()))))
);

-- Redefines 20260928160000_party_mixed_rooms.sql's version: in a party room
-- the signal goes to the recipient's own topic.
CREATE OR REPLACE FUNCTION public.send_webrtc_signal(p_room_id uuid, p_to_player_id uuid, p_signal jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from uuid;
  v_party boolean;
begin
  v_from := private.ludo_caller_player_id(p_room_id);
  if v_from is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;
  v_party := (select is_party from public.rooms where id = p_room_id);
  if v_party
    and not (
      (select party_remote from public.players where id = v_from)
      and (select party_remote from public.players where id = p_to_player_id)
    ) then
    raise exception 'PARTY_ROOM';
  end if;

  if not exists(select 1 from public.players where id = p_to_player_id and room_id = p_room_id) then
    raise exception 'INVALID_SIGNAL_TARGET';
  end if;

  perform realtime.send(
    jsonb_build_object('from', v_from, 'to', p_to_player_id, 'signal', p_signal),
    'webrtc_signal',
    case when v_party then 'player:' || p_to_player_id::text else 'room:' || p_room_id::text end,
    true
  );
end;
$function$;
