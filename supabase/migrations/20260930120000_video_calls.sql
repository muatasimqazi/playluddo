-- Video chat: faces at the table (docs/COMPETITIVE_ROADMAP.md Section 7, V0 + V2).
--
-- Video rides on the existing audio call (20260916230000_voice_calls.sql): the
-- same full-mesh WebRTC connections, the same `send_webrtc_signal` relay, and
-- the same roster threaded through ludo_room_state_json. All this adds on the
-- server is a `camera_on` boolean per seat (mirroring `in_voice`) and the V0
-- gate: who may turn a camera on, and where.
--
-- V0 rules (Section 12, questions 5 and 10):
--   * Video is 18+ and signed-in only. Eligibility reuses the birth month/year
--     from F0.4 (20260928060000_online_age_check.sql) with an 18-year threshold
--     — no second question.
--   * The WHOLE table has to qualify: video is offered only when every seated
--     human is signed in and 18+. One ineligible or guest seat and no one gets
--     video, and the client copy never says who or why.
--   * Never in quick match or other public tables — private rooms only.
--   * Enforced on the server: set_camera_on rejects ineligible callers and
--     unqualified tables, and send_webrtc_signal rejects video SDP for a table
--     that isn't video-allowed. This defends the supported protocol over direct
--     connections only; it cannot stop colluding modified clients (question 10).
--
-- Behind the 'video_chat' feature flag, OFF by default (Section 15, R11). Until
-- it is switched on nobody is offered video and set_camera_on always rejects:
--
--   update private.feature_flags set enabled = true where name = 'video_chat';

insert into private.feature_flags (name, enabled) values ('video_chat', false);

-- Quick-match rooms are created through the same create_room path as private
-- rooms, so they need an explicit marker to keep video out of public tables.
alter table public.rooms add column matchmade boolean not null default false;

alter table public.players add column camera_on boolean not null default false;

-- ---------------------------------------------------------------------------
-- V0 eligibility helpers.

-- One user's video eligibility: signed in (not anonymous) and 18+, computed
-- from their F0.4 declaration the same way get_age_eligibility().video is.
-- Fails closed — a user who never declared, or a guest seat (null user_id),
-- is not eligible, so a table with no age data offers video to no one.
create or replace function private.ludo_user_video_eligible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and not coalesce((select is_anonymous from auth.users where id = p_user_id), true)
    and exists (
      select 1 from private.age_declarations d
      where d.user_id = p_user_id
        and d.birth_year is not null
        and current_date >= private.age_eligible_from(d.birth_year, d.birth_month, 18)
    );
$$;
revoke execute on function private.ludo_user_video_eligible(uuid) from public;

-- Whether a table may use video at all: the feature is on, the room is private
-- (not a quick match), and every seated human is video-eligible. Computers
-- don't count. Table-wide, so it broadcasts the same to everyone.
create or replace function private.ludo_table_video_allowed(p_room_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_matchmade boolean;
begin
  if not private.feature_enabled('video_chat') then return false; end if;
  select matchmade into v_matchmade from public.rooms where id = p_room_id;
  if v_matchmade is null or v_matchmade then return false; end if;
  return not exists (
    select 1 from public.players p
    where p.room_id = p_room_id
      and not p.is_bot
      and not private.ludo_user_video_eligible(p.user_id)
  );
end;
$$;
revoke execute on function private.ludo_table_video_allowed(uuid) from public;

-- ---------------------------------------------------------------------------
-- Snapshot: add cameraOn per seat and videoAllowed for the table. Based on the
-- latest definition (20260929110000_watch_tables.sql), unchanged apart from
-- those two keys.
CREATE OR REPLACE FUNCTION private.ludo_room_state_json(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'roomId', r.id, 'hostPlayerId', r.host_player_id, 'code', r.code, 'gameType', r.game_type,
    'status', r.status, 'paused', r.paused_at is not null, 'maxPlayers', r.max_players,
    'pausedForPlayerId', r.paused_for_player_id, 'pausedAt', r.paused_at,
    'rules', private.ludo_resolve_rules(r.rules),
    'matchId', r.current_match_id,
    'isParty', r.is_party, 'partyLocked', r.party_locked,
    'watchingEnabled', r.watching_enabled,
    'watcherCount', (select count(*) from public.room_watchers where room_id = r.id),
    'partyTurnSeconds', (private.ludo_resolve_rules(coalesce(nullif(r.match_rules, '{}'::jsonb), r.rules))->>'turnSeconds')::int,
    'matchEndsAt', r.match_ends_at,
    'videoAllowed', private.ludo_table_video_allowed(r.id),
    'diceCommitment', (select m.dice_commitment from public.matches m where m.id = r.current_match_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name, 'color', p.color,
      'status', p.status, 'isBot', p.is_bot, 'missedDecisionCount', p.missed_decision_count,
      'level', coalesce((select pr.level from public.player_progression pr where pr.user_id = p.user_id), 1),
      'testWalletBalance', p.test_wallet_balance, 'autoRollEnabled', p.auto_roll_enabled,
      'rematchReady', p.rematch_ready, 'inVoice', p.in_voice, 'cameraOn', p.camera_on, 'partyRemote', p.party_remote,
      'hasCaptured', p.has_captured,
      'avatarId', coalesce((select u.raw_user_meta_data ->> 'avatar_id' from auth.users u where u.id = p.user_id), (array['fox','panda','owl','frog'])[p.seat_index + 1]),
      'country', coalesce((select u.raw_user_meta_data ->> 'country' from auth.users u where u.id = p.user_id), ''),
      'cosmetics', coalesce((select jsonb_object_agg(pl.type, pl.cosmetic_id)
        from public.player_loadout pl where pl.user_id = p.user_id), '{}'::jsonb)
    ) order by p.seat_index) from public.players p where p.room_id = r.id), '[]'::jsonb),
    'pawns', private.ludo_room_pawns_json(r.id), 'turnPlayerId', r.turn_player_id,
    'turnPhase', r.turn_phase, 'turnDeadlineAt', r.turn_deadline_at, 'rollsThisTurn', r.rolls_this_turn,
    'activeDiceValue', r.active_dice_value, 'consecutiveSixes', r.consecutive_sixes,
    'legalMoves', case when r.game_type = 'ludo' and r.turn_phase = 'awaiting_move' and r.turn_player_id is not null and r.active_dice_value is not null then private.ludo_legal_moves(private.ludo_room_pawns_json(r.id), (select color from public.players where id = r.turn_player_id), r.active_dice_value, r.match_rules, (select has_captured from public.players where id = r.turn_player_id)) else '[]'::jsonb end,
    'winnerIds', coalesce(to_jsonb(r.winner_ids), '[]'::jsonb), 'matchEndReason', r.match_end_reason,
    'eventSequence', r.event_sequence
  ) from public.rooms r where r.id = p_room_id;
$function$;
revoke execute on function private.ludo_room_state_json(uuid) from public;

-- ---------------------------------------------------------------------------
-- Turn this seat's camera on or off. Video only rides on an active call, so a
-- camera going on doesn't join the call by itself — the client joins voice
-- first. Turning it on is gated by V0; turning it off never is.
create or replace function public.set_camera_on(p_room_id uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  v_caller := private.ludo_caller_player_id(p_room_id);
  if v_caller is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  if p_on and not private.ludo_table_video_allowed(p_room_id) then
    -- The client shows a single neutral message; it never names a seat.
    raise exception 'VIDEO_NOT_ALLOWED';
  end if;

  update public.players set camera_on = p_on where id = v_caller;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('cameraOn', p_on);
end;
$$;
revoke execute on function public.set_camera_on(uuid, boolean) from public, anon;
grant execute on function public.set_camera_on(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Signaling gate. send_webrtc_signal already relays offers/answers/ICE for the
-- call. Reject any offer/answer that negotiates a video section on a table that
-- isn't video-allowed: audio-only tables must carry no video m-line, so this
-- keeps a modified client from opening a video channel the table can't have.
-- A defense for the supported protocol only (Section 12, question 10) — it
-- can't police a data channel or a different transport.
create or replace function public.send_webrtc_signal(p_room_id uuid, p_to_player_id uuid, p_signal jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid;
begin
  v_from := private.ludo_caller_player_id(p_room_id);
  if v_from is null then
    raise exception 'SEAT_NOT_CONTROLLED';
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
    'room:' || p_room_id::text,
    true
  );
end;
$$;
revoke execute on function public.send_webrtc_signal(uuid, uuid, jsonb) from public, anon;
grant execute on function public.send_webrtc_signal(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Leaving the call drops the camera too (video only rides on the call). Based
-- on 20260916230000_voice_calls.sql, with camera_on cleared alongside in_voice.
create or replace function public.leave_voice(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_player_id uuid;
begin
  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  update public.players set in_voice = false, camera_on = false where id = v_caller_player_id;

  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('inVoice', false);
end;
$$;
revoke execute on function public.leave_voice(uuid) from public, anon;
grant execute on function public.leave_voice(uuid) to authenticated;

-- A fresh tab/reconnect must never inherit a stale camera flag, exactly as it
-- must not inherit a stale in_voice. Based on the latest claim_seat
-- (20260928060000_online_age_check.sql), with camera_on added to the reset.
CREATE OR REPLACE FUNCTION public.claim_seat(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller_player_id uuid;
  v_token uuid;
begin
  -- A player returning to a running or just-ended match isn't interrupted
  -- (decision 12); coming back to a lobby for a new match is checked.
  if (select status from public.rooms where id = p_room_id) = 'lobby' then
    perform private.require_online_eligibility();
  end if;
  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  v_token := gen_random_uuid();

  update public.players
  set live_connection_token = v_token, last_seen_at = now(), in_voice = false, camera_on = false
  where id = v_caller_player_id;

  return jsonb_build_object('playerId', v_caller_player_id, 'connectionToken', v_token);
end;
$function$;

-- Mark quick-match rooms so ludo_table_video_allowed keeps video out of them.
-- Based on 20260927040000_matchmaking_fill_empty_seats.sql, unchanged apart
-- from setting rooms.matchmade alongside game_type.
create or replace function private.matchmaking_start_room(
  p_display_name text,
  p_game_type text,
  p_player_count int,
  p_user_ids uuid[],
  p_names text[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_room_id uuid;
  v_humans int := coalesce(array_length(p_user_ids, 1), 0);
  v_bot_names text[] := array['Rowan', 'Sage', 'Jules', 'Avery', 'Kai', 'Maya', 'Theo', 'Nia'];
  v_bot record;
  v_seat int;
begin
  v_room_id := (public.create_room(p_display_name, null, p_player_count) ->> 'roomId')::uuid;
  update public.rooms set game_type = p_game_type, matchmade = true where id = v_room_id;

  if p_player_count = 2 then
    if v_humans = 0 then
      perform public.fill_bot(v_room_id, 2);
    else
      insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
      values (v_room_id, 2, p_user_ids[1], p_names[1], private.ludo_color_for_seat(2), 'connected', false);
    end if;
  else
    for v_seat in 1..v_humans loop
      insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot)
      values (v_room_id, v_seat, p_user_ids[v_seat], p_names[v_seat], private.ludo_color_for_seat(v_seat), 'connected', false);
    end loop;
    for v_seat in (v_humans + 1)..(p_player_count - 1) loop
      perform public.fill_bot(v_room_id, v_seat);
    end loop;
  end if;

  perform public.start_match(v_room_id);

  -- Distinct friendly names for the computers, in a random order.
  for v_bot in
    select p.id, row_number() over (order by p.seat_index) as n
    from public.players p where p.room_id = v_room_id and p.is_bot
  loop
    update public.players set display_name = (
      select name from unnest(v_bot_names) with ordinality as t(name, ord)
      order by md5(v_room_id::text || ord::text) offset v_bot.n - 1 limit 1
    ) where id = v_bot.id;
  end loop;
  perform private.ludo_broadcast_state(v_room_id);

  return v_room_id;
end;
$$;
revoke execute on function private.matchmaking_start_room(text, text, int, uuid[], text[]) from public;
