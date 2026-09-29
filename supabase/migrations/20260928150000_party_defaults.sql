-- Party defaults and safety (docs/COMPETITIVE_ROADMAP.md P7, R3/R4/R7).
-- Family is the minimal Party default, not a configurable preset yet.
-- Existing running games keep their timer; only new rooms opt into 30 seconds.
alter table public.rooms add column party_turn_seconds integer not null default 15 check (party_turn_seconds in (15,30));
alter table public.rooms add column party_locked boolean not null default false;
alter table public.party_audience add column id uuid not null default gen_random_uuid() unique;
create trigger audience_clean_name before insert or update of display_name on public.party_audience
for each row execute function private.clean_player_name();
update public.party_audience set display_name = private.clean_text(display_name);

create table private.party_removals (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (room_id, user_id)
);
revoke all on private.party_removals from public, anon, authenticated;

-- Redefines 20260928090000_party_screen.sql (live definition).
CREATE OR REPLACE FUNCTION public.create_party_room(p_game_type text DEFAULT 'ludo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room_id uuid;
  v_code text;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_game_type is null or p_game_type not in ('ludo', 'snakes_and_ladders') then
    raise exception 'INVALID_GAME_TYPE';
  end if;
  v_code := private.ludo_generate_room_code();
  insert into public.rooms (code, status, max_players, game_type, is_party, party_turn_seconds)
  values (v_code, 'lobby', 4, p_game_type, true, 30)
  returning id into v_room_id;
  insert into public.room_displays (room_id, user_id) values (v_room_id, (select auth.uid()));
  return jsonb_build_object('roomId', v_room_id, 'code', v_code);
end;
$function$;

-- Redefines 20260918020000_snakes_and_ladders.sql (live definition).
CREATE OR REPLACE FUNCTION private.ludo_next_turn_deadline(p_player_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when private.ludo_is_bot_controlled(p_player_id) then now() + case
      when exists (select 1 from public.players p join public.rooms r on r.id = p.room_id
        where p.id = p_player_id and r.game_type = 'snakes_and_ladders')
      then interval '5.5 seconds' else interval '2 seconds' end
    else now() + make_interval(secs => coalesce((select case when r.is_party then r.party_turn_seconds else 15 end from public.players p join public.rooms r on r.id = p.room_id where p.id = p_player_id), 15))
  end;
$function$;

-- Redefines 20260928130000_party_reconnect.sql (live definition).
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
    'isParty', r.is_party, 'partyLocked', r.party_locked, 'partyTurnSeconds', r.party_turn_seconds,
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

-- Redefines 20260928140000_party_audience.sql (live definition).
CREATE OR REPLACE FUNCTION public.room_invite(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'isSeated', exists (select 1 from public.players where room_id = p_room_id and user_id = (select auth.uid())),
    'isParty', v_room.is_party, 'partyLocked', v_room.party_locked,
    'isAudience', private.party_is_audience(p_room_id)
  );
end;
$function$;

-- Redefines 20260928140000_party_audience.sql (live definition).
CREATE OR REPLACE FUNCTION private.party_seat_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.user_id is not null and exists (
    select 1 from public.room_displays where room_id = new.room_id and user_id = new.user_id
  ) then
    raise exception 'DISPLAY_CANNOT_SIT';
  end if;
  if new.user_id is not null and not exists (
    select 1 from public.players where room_id = new.room_id and user_id = new.user_id
  ) and (select party_locked from public.rooms where id = new.room_id) then
    raise exception 'PARTY_LOCKED';
  end if;
  if exists (select 1 from private.party_removals where room_id = new.room_id and user_id = new.user_id) then
    raise exception 'PARTY_REMOVED';
  end if;
  if new.user_id is not null then
    delete from public.party_audience where room_id = new.room_id and user_id = new.user_id;
  end if;
  return new;
end;
$function$;

-- Redefines 20260928140000_party_audience.sql (live definition).
CREATE OR REPLACE FUNCTION public.join_party_audience(p_room_id uuid, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  perform private.require_online_eligibility();
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.status = 'abandoned' then raise exception 'ROOM_NOT_FOUND'; end if;
  if not v_room.is_party then raise exception 'NOT_PARTY_ROOM'; end if;
  if exists (select 1 from public.room_displays where room_id = p_room_id and user_id = (select auth.uid())) then
    raise exception 'DISPLAY_CANNOT_SIT';
  end if;
  if exists (select 1 from public.players where room_id = p_room_id and user_id = (select auth.uid())) then
    raise exception 'ALREADY_SEATED';
  end if;
  if exists (select 1 from private.party_removals where room_id = p_room_id and user_id = (select auth.uid())) then raise exception 'PARTY_REMOVED'; end if;
  if v_room.status = 'lobby' and not v_room.party_locked
    and (select count(*) from public.players where room_id = p_room_id) < v_room.max_players then
    raise exception 'SEATS_OPEN';
  end if;
  if char_length(v_name) not between 1 and 24 then raise exception 'INVALID_NAME'; end if;
  if not exists (select 1 from public.party_audience where room_id = p_room_id and user_id = (select auth.uid()))
    and (select count(*) from public.party_audience where room_id = p_room_id) >= 30 then
    raise exception 'AUDIENCE_FULL';
  end if;
  insert into public.party_audience (room_id, user_id, display_name)
  values (p_room_id, (select auth.uid()), v_name)
  on conflict (room_id, user_id) do update set display_name = excluded.display_name;
  perform private.party_extras_changed(p_room_id);
  return jsonb_build_object('roomId', p_room_id);
end;
$function$;

-- Redefines 20260928140000_party_audience.sql (live definition).
CREATE OR REPLACE FUNCTION public.get_party_extras(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_uid uuid := (select auth.uid());
  v_ended boolean;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found or not v_room.is_party
    or not (private.ludo_is_display_of_room(p_room_id) or private.party_is_audience(p_room_id)
            or private.ludo_is_seated_in_room(p_room_id)) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  v_ended := v_room.status = 'summary' and v_room.current_match_id is not null;
  return jsonb_build_object(
    'isAudience', private.party_is_audience(p_room_id),
    'audienceTopic', (select 'audience:' || id::text from public.party_audience where room_id = p_room_id and user_id = v_uid),
    'audienceMembers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', display_name, 'isMe', user_id = v_uid) order by joined_at) from public.party_audience where room_id = p_room_id), '[]'::jsonb),
    'audience', coalesce((select jsonb_agg(display_name order by joined_at) from public.party_audience where room_id = p_room_id), '[]'::jsonb),
    'predictions', coalesce((
      select jsonb_agg(jsonb_build_object('playerId', predicted_player_id, 'count', n))
      from (select predicted_player_id, count(*) n from public.party_audience
            where room_id = p_room_id and predicted_player_id is not null group by predicted_player_id) t
    ), '[]'::jsonb),
    'myPrediction', (select predicted_player_id from public.party_audience where room_id = p_room_id and user_id = v_uid),
    'lockedPrediction', (select player_id from public.party_predictions where match_id = v_room.current_match_id and user_id = v_uid),
    'calledIt', case when v_ended and cardinality(v_room.winner_ids) > 0 then coalesce((
      select jsonb_agg(display_name order by display_name) from public.party_predictions
      where match_id = v_room.current_match_id and player_id = v_room.winner_ids[1]
    ), '[]'::jsonb) end,
    'predictionCount', (select count(*) from public.party_predictions where match_id = v_room.current_match_id),
    'moments', case when v_ended then private.party_moments(v_room.current_match_id) else '[]'::jsonb end,
    'votes', case when v_ended then coalesce((
      select jsonb_agg(jsonb_build_object('sequence', sequence, 'count', n))
      from (select sequence, count(*) n from public.party_votes where match_id = v_room.current_match_id group by sequence) t
    ), '[]'::jsonb) else '[]'::jsonb end,
    'myVote', (select sequence from public.party_votes where match_id = v_room.current_match_id and user_id = v_uid)
  );
end;
$function$;

-- Redefines 20260927010000_matchmaking.sql's response helper.
create or replace function private.matchmaking_matched(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.rooms where id = p_room_id and not is_party) then
    raise exception 'NOT_MATCHMAKING_ROOM';
  end if;
  return jsonb_build_object('status', 'matched', 'roomId', p_room_id,
    'players', (select count(*) from public.players where room_id = p_room_id),
    'computers', (select count(*) from public.players where room_id = p_room_id and is_bot));
end;
$$;

create or replace function public.set_party_locked(p_room_id uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not v_room.is_party or not private.ludo_is_display_of_room(p_room_id) then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.status not in ('in_game', 'summary') then raise exception 'INVALID_PHASE'; end if;
  if p_locked is null then raise exception 'INVALID_ARGUMENT'; end if;
  update public.rooms set party_locked = p_locked where id = p_room_id;
  perform private.ludo_broadcast_state(p_room_id);
end;
$$;
revoke execute on function public.set_party_locked(uuid, boolean) from public;
grant execute on function public.set_party_locked(uuid, boolean) to authenticated;

-- Redefines 20260928010000_moderation.sql (live definition).
CREATE OR REPLACE FUNCTION private.ludo_other_player_user(p_room_id uuid, p_player_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  if private.ludo_caller_player_id(p_room_id) is null and not private.party_is_audience(p_room_id) then raise exception 'SEAT_NOT_CONTROLLED'; end if;
  select p.user_id into v_user
  from public.players p
  where p.id = p_player_id and p.room_id = p_room_id and not p.is_bot;
  if v_user is null or v_user = (select auth.uid()) then raise exception 'PLAYER_NOT_FOUND'; end if;
  return v_user;
end;
$function$;

-- Audience IDs are room membership IDs, never account IDs.
create or replace function public.report_party_audience(p_room_id uuid, p_member_id uuid, p_reason text, p_details text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.party_audience; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (private.ludo_is_seated_in_room(p_room_id) or private.party_is_audience(p_room_id)) then raise exception 'ROOM_NOT_FOUND'; end if;
  select * into v_member from public.party_audience where room_id = p_room_id and id = p_member_id;
  if not found or v_member.user_id = v_uid then raise exception 'PLAYER_NOT_FOUND'; end if;
  if p_reason is null or p_reason not in ('harassment','hate','sexual','spam','cheating','other') or char_length(p_details) > 500 then raise exception 'INVALID_REPORT'; end if;
  -- Serialise the per-account quota, including reports about seated players.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 7));
  if (select count(*) from public.player_reports where reporter_user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You''ve sent several reports recently. Please try again later.';
  end if;
  insert into public.player_reports (reporter_user_id, reported_user_id, room_id, reported_display_name, reason, details)
  values (v_uid, v_member.user_id, p_room_id, v_member.display_name, p_reason, nullif(btrim(p_details), ''));
end;
$$;
revoke execute on function public.report_party_audience(uuid, uuid, text, text) from public;
grant execute on function public.report_party_audience(uuid, uuid, text, text) to authenticated;

create or replace function public.remove_party_audience(p_room_id uuid, p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_member public.party_audience; v_host uuid;
begin
  select host_player_id into v_host from public.rooms where id = p_room_id and is_party for update;
  if v_host is null or v_host is distinct from private.ludo_caller_player_id(p_room_id) then raise exception 'NOT_HOST'; end if;
  select * into v_member from public.party_audience where room_id = p_room_id and id = p_member_id for update;
  if not found then raise exception 'NOT_AUDIENCE'; end if;
  insert into private.party_removals values (p_room_id, v_member.user_id) on conflict do nothing;
  delete from public.party_predictions where user_id = v_member.user_id and match_id in (select id from public.matches where room_id = p_room_id);
  delete from public.party_votes where user_id = v_member.user_id and match_id in (select id from public.matches where room_id = p_room_id);
  delete from public.party_audience where id = p_member_id;
  perform realtime.send('{}'::jsonb, 'audience_removed', 'audience:' || p_member_id::text, true);
  perform private.party_extras_changed(p_room_id);
end;
$$;
revoke execute on function public.remove_party_audience(uuid, uuid) from public;
grant execute on function public.remove_party_audience(uuid, uuid) to authenticated;

-- Realtime caches subscription permissions. A removed audience phone must
-- stop receiving updates even if it keeps its socket open: deliver to each
-- active membership's own topic, never to the shared player/screen topic.
drop policy "party audience can receive their room's broadcasts" on realtime.messages;
create or replace function private.party_audience_topic_allowed(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.party_audience where user_id = (select auth.uid()) and 'audience:' || id::text = p_topic);
$$;
revoke execute on function private.party_audience_topic_allowed(text) from public;
grant execute on function private.party_audience_topic_allowed(text) to authenticated;
create policy "audience receives its own membership updates" on realtime.messages for select to authenticated
using (extension = 'broadcast' and private.party_audience_topic_allowed((select realtime.topic())));

-- Redefines 20260913222115_rpcs.sql with revocable audience delivery.
create or replace function private.ludo_broadcast_state(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_payload jsonb;
begin
  v_payload := private.ludo_room_state_json(p_room_id);
  perform realtime.send(v_payload, 'state_updated', 'room:' || p_room_id::text, true);
  for v_id in select id from public.party_audience where room_id = p_room_id loop
    perform realtime.send(v_payload, 'state_updated', 'audience:' || v_id::text, true);
  end loop;
end;
$$;
revoke execute on function private.ludo_broadcast_state(uuid) from public;

-- Redefines 20260928140000_party_audience.sql with revocable audience delivery.
create or replace function private.party_extras_changed(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_payload jsonb;
begin
  v_payload := '{}'::jsonb;
  perform realtime.send(v_payload, 'party_extras', 'room:' || p_room_id::text, true);
  for v_id in select id from public.party_audience where room_id = p_room_id loop
    perform realtime.send(v_payload, 'party_extras', 'audience:' || v_id::text, true);
  end loop;
end;
$$;
revoke execute on function private.party_extras_changed(uuid) from public;

-- Redefines 20260928140000_party_audience.sql (live definition).
CREATE OR REPLACE FUNCTION private.party_audience_action(p_room_id uuid)
 RETURNS party_audience
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.party_audience;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  perform 1 from public.rooms where id = p_room_id for update;
  select * into v_member from public.party_audience
  where room_id = p_room_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'NOT_AUDIENCE'; end if;
  if v_member.last_action_at > now() - interval '1 second' then
    raise exception 'Please wait a moment before sending another.';
  end if;
  update public.party_audience set last_action_at = now()
  where room_id = p_room_id and user_id = v_member.user_id;
  return v_member;
end;
$function$;

-- Redefines 20260928010000_moderation.sql (live definition).
CREATE OR REPLACE FUNCTION public.report_player(p_room_id uuid, p_player_id uuid, p_reason text, p_details text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target uuid := private.ludo_other_player_user(p_room_id, p_player_id);
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if p_reason is null or p_reason not in ('harassment', 'hate', 'sexual', 'spam', 'cheating', 'other') then
    raise exception 'INVALID_REPORT';
  end if;
  if v_details is not null and char_length(v_details) > 500 then raise exception 'INVALID_REPORT'; end if;
  perform pg_advisory_xact_lock(hashtextextended((select auth.uid())::text, 7));
  if (
    select count(*) from public.player_reports
    where reporter_user_id = (select auth.uid()) and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'You''ve sent several reports recently. Please try again later.';
  end if;
  insert into public.player_reports (
    reporter_user_id, reported_user_id, room_id, reported_player_id,
    reported_display_name, reason, details, recent_messages
  )
  select
    (select auth.uid()), v_target, p_room_id, p_player_id,
    p.display_name, p_reason, v_details,
    coalesce((
      select jsonb_agg(jsonb_build_object('text', m.text, 'createdAt', m.created_at) order by m.created_at)
      from (
        select text, created_at from public.table_messages
        where room_id = p_room_id and player_id = p_player_id and kind = 'chat'
        order by created_at desc limit 20
      ) m
    ), '[]'::jsonb)
  from public.players p
  where p.id = p_player_id;
end;
$function$;

revoke execute on function private.ludo_next_turn_deadline(uuid) from public;

revoke execute on function private.ludo_room_state_json(uuid) from public;

revoke execute on function private.party_seat_rules() from public;

revoke execute on function private.matchmaking_matched(uuid) from public;

revoke execute on function private.ludo_other_player_user(uuid, uuid) from public;

revoke execute on function private.party_audience_action(uuid) from public;

-- Resolve a code before accepting a name, so Party code joins get the
-- same short agreement and age flow as QR/link joins.
create or replace function public.room_id_for_code(p_code text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select id into v_id from public.rooms where code = upper(btrim(p_code));
  if v_id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  return v_id;
end;
$$;
revoke execute on function public.room_id_for_code(text) from public;
grant execute on function public.room_id_for_code(text) to authenticated;
