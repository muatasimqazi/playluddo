-- Restores the Party Mode rules in call signalling.
--
-- 20260930120000_video_calls.sql redefined send_webrtc_signal from the
-- original voice-call version, which dropped two later changes:
--
--   - 20260928160000_party_mixed_rooms.sql: in a party room, signalling only
--     runs between two players who both joined from elsewhere. Living-room
--     phones have no call (P8).
--   - 20260928170000_party_call_topics.sql: in a party room, a signal goes to
--     the recipient's own topic (player:<id>), not the room topic the
--     living-room screen subscribes to. Offers, answers and ICE candidates
--     carry network addresses (Section 15, R4).
--
-- This version keeps both, plus video_calls' check that video SDP is only
-- sent on a table that permits video (V0).

create or replace function public.send_webrtc_signal(p_room_id uuid, p_to_player_id uuid, p_signal jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
      coalesce((select party_remote from public.players where id = v_from), false)
      and coalesce((select party_remote from public.players where id = p_to_player_id), false)
    ) then
    raise exception 'PARTY_ROOM';
  end if;

  if not exists(select 1 from public.players where id = p_to_player_id and room_id = p_room_id) then
    raise exception 'INVALID_SIGNAL_TARGET';
  end if;

  if position('m=video' in coalesce(p_signal->>'sdp', '')) > 0
     and not private.ludo_table_video_allowed(p_room_id) then
    raise exception 'VIDEO_NOT_ALLOWED';
  end if;

  perform realtime.send(
    jsonb_build_object('from', v_from, 'to', p_to_player_id, 'signal', p_signal),
    'webrtc_signal',
    case when v_party then 'player:' || p_to_player_id::text else 'room:' || p_room_id::text end,
    true
  );
end;
$$;
revoke execute on function public.send_webrtc_signal(uuid, uuid, jsonb) from public, anon;
grant execute on function public.send_webrtc_signal(uuid, uuid, jsonb) to authenticated;
