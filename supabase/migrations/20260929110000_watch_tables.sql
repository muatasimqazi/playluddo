-- Watching live tables (docs/COMPETITIVE_ROADMAP.md F4.4; decision 15).
--
-- A watcher follows a friend's or team's ordinary (non-party) table without
-- taking a seat. Watching is OFF by default: the host turns it on, and any
-- seated human can turn it off, which evicts current watchers at once. Watchers
-- are 13+ (they pass the same F0.4 age check as players) and read-only, with
-- reactions only -- never chat or call signalling (R4/R7).
--
-- Delivery reuses the Party screen's read-only path (P1), but on a per-watcher
-- topic `watch:<watcher-id>` the server sends only game state and watcher
-- reactions to. Chat and WebRTC signalling stay on `room:<id>`, which watchers
-- never subscribe to, so they can't receive them.

alter table public.rooms add column watching_enabled boolean not null default false;

create table public.room_watchers (
  -- Suffix of this watcher's private delivery topic (`watch:<id>`).
  id uuid not null default gen_random_uuid() unique,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  -- One reaction a second.
  last_action_at timestamptz not null default '-infinity',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table public.room_watchers enable row level security;
revoke all on public.room_watchers from anon, authenticated;

create or replace function private.ludo_is_watcher_of_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_watchers
    where room_id = p_room_id and user_id = (select auth.uid())
  );
$$;
revoke execute on function private.ludo_is_watcher_of_room(uuid) from public;
grant execute on function private.ludo_is_watcher_of_room(uuid) to authenticated;

-- A watcher may receive broadcasts only on its own `watch:<id>` topic, which
-- carries game state and watcher reactions -- never chat or call signalling.
create or replace function private.watch_topic_allowed(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_watchers
    where user_id = (select auth.uid()) and 'watch:' || id::text = p_topic
  );
$$;
revoke execute on function private.watch_topic_allowed(text) from public;
grant execute on function private.watch_topic_allowed(text) to authenticated;

create policy "watchers receive their own read-only broadcasts"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and (select private.watch_topic_allowed((select realtime.topic())))
);

-- Watchers animate rolls and moves from the event log, like seated phones and
-- the Party screen. Events hold no secrets (the dice seed stays in
-- private.match_dice until the match ends).
create policy "watchers can read events in their room" on public.match_events
for select to authenticated
using ( (select private.ludo_is_watcher_of_room(room_id)) );

-- Redefines 20260928150000_party_defaults.sql's version: state also fans out to
-- each watcher's private topic.
create or replace function private.ludo_broadcast_state(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_payload jsonb;
begin
  v_payload := private.ludo_room_state_json(p_room_id);
  perform realtime.send(v_payload, 'state_updated', 'room:' || p_room_id::text, true);
  for v_id in select id from public.party_audience where room_id = p_room_id loop
    perform realtime.send(v_payload, 'state_updated', 'audience:' || v_id::text, true);
  end loop;
  for v_id in select id from public.room_watchers where room_id = p_room_id loop
    perform realtime.send(v_payload, 'state_updated', 'watch:' || v_id::text, true);
  end loop;
end;
$$;
revoke execute on function private.ludo_broadcast_state(uuid) from public;

-- Redefines 20260929070000_cosmetics.sql's version: adds whether watching is on
-- and how many are watching, so seat labels can show it.
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
    'diceCommitment', (select m.dice_commitment from public.matches m where m.id = r.current_match_id),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'seatIndex', p.seat_index, 'displayName', p.display_name, 'color', p.color,
      'status', p.status, 'isBot', p.is_bot, 'missedDecisionCount', p.missed_decision_count,
      'level', coalesce((select pr.level from public.player_progression pr where pr.user_id = p.user_id), 1),
      'testWalletBalance', p.test_wallet_balance, 'autoRollEnabled', p.auto_roll_enabled,
      'rematchReady', p.rematch_ready, 'inVoice', p.in_voice, 'partyRemote', p.party_remote,
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

-- The host turns watching on; any seated human turns it off, which evicts every
-- current watcher at once (decision 15). Never for party rooms (they have their
-- own audience).
create or replace function public.set_watching(p_room_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.is_party then raise exception 'PARTY_ROOM'; end if;

  v_caller := private.ludo_caller_player_id(p_room_id);
  if v_caller is null then raise exception 'SEAT_NOT_CONTROLLED'; end if;

  -- Only the host may open watching; anyone seated may close it.
  if p_enabled and v_room.host_player_id is distinct from v_caller then
    raise exception 'NOT_HOST';
  end if;

  update public.rooms set watching_enabled = p_enabled where id = p_room_id;

  if not p_enabled then
    for v_id in select id from public.room_watchers where room_id = p_room_id loop
      perform realtime.send('{}'::jsonb, 'watching_ended', 'watch:' || v_id::text, true);
    end loop;
    delete from public.room_watchers where room_id = p_room_id;
  end if;

  perform private.ludo_broadcast_state(p_room_id);
  return jsonb_build_object('watchingEnabled', p_enabled);
end;
$$;
revoke execute on function public.set_watching(uuid, boolean) from public;
grant execute on function public.set_watching(uuid, boolean) to authenticated;

-- Start watching a table. Off-by-default gate, 13+ age check, and a seat or a
-- display can't also watch. Returns the private topic to subscribe to.
create or replace function public.join_watch(p_room_id uuid, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_id uuid;
begin
  perform private.require_online_eligibility();
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  if char_length(v_name) not between 1 and 24 then raise exception 'INVALID_NAME'; end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.status = 'abandoned' then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.is_party then raise exception 'NOT_WATCHABLE'; end if;
  if not v_room.watching_enabled then raise exception 'WATCHING_OFF'; end if;
  if exists (select 1 from public.players where room_id = p_room_id and user_id = (select auth.uid())) then
    raise exception 'ALREADY_SEATED';
  end if;

  if not exists (select 1 from public.room_watchers where room_id = p_room_id and user_id = (select auth.uid()))
    and (select count(*) from public.room_watchers where room_id = p_room_id) >= 50 then
    raise exception 'WATCHERS_FULL';
  end if;

  insert into public.room_watchers (room_id, user_id, display_name)
  values (p_room_id, (select auth.uid()), v_name)
  on conflict (room_id, user_id) do update set display_name = excluded.display_name
  returning id into v_id;

  perform private.ludo_broadcast_state(p_room_id);
  return jsonb_build_object('roomId', p_room_id, 'watchTopic', 'watch:' || v_id::text);
end;
$$;
revoke execute on function public.join_watch(uuid, text) from public;
grant execute on function public.join_watch(uuid, text) to authenticated;

create or replace function public.leave_watch(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  delete from public.room_watchers where room_id = p_room_id and user_id = (select auth.uid());
  perform private.ludo_broadcast_state(p_room_id);
end;
$$;
revoke execute on function public.leave_watch(uuid) from public;
grant execute on function public.leave_watch(uuid) to authenticated;

-- A watcher's read-only view of the table: the same public state players get.
create or replace function public.get_watch_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.ludo_is_watcher_of_room(p_room_id) then raise exception 'ROOM_NOT_FOUND'; end if;
  return private.ludo_room_state_json(p_room_id);
end;
$$;
revoke execute on function public.get_watch_state(uuid) from public;
grant execute on function public.get_watch_state(uuid) to authenticated;

-- Locks the caller's watcher row and applies the one-a-second limit.
create or replace function private.watcher_action(p_room_id uuid)
returns public.room_watchers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.room_watchers;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_member from public.room_watchers
  where room_id = p_room_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'NOT_WATCHING'; end if;
  if v_member.last_action_at > now() - interval '1 second' then
    raise exception 'Please wait a moment before sending another.';
  end if;
  update public.room_watchers set last_action_at = now()
  where room_id = p_room_id and user_id = v_member.user_id;
  return v_member;
end;
$$;
revoke execute on function private.watcher_action(uuid) from public;

-- A watcher's reaction, shown to the table and other watchers with the sender's
-- name. Nothing is stored. The only thing a watcher can send (no chat).
create or replace function public.watcher_react(p_room_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.room_watchers;
  v_id uuid;
  v_payload jsonb;
begin
  if p_text is null or not (p_text = any(private.allowed_reactions())) then raise exception 'INVALID_MESSAGE'; end if;
  v_member := private.watcher_action(p_room_id);
  v_payload := jsonb_build_object('id', gen_random_uuid(), 'name', v_member.display_name, 'text', p_text);
  perform realtime.send(v_payload, 'watcher_reaction', 'room:' || p_room_id::text, true);
  for v_id in select id from public.room_watchers where room_id = p_room_id loop
    perform realtime.send(v_payload, 'watcher_reaction', 'watch:' || v_id::text, true);
  end loop;
end;
$$;
revoke execute on function public.watcher_react(uuid, text) from public;
grant execute on function public.watcher_react(uuid, text) to authenticated;

-- Report a watcher. Extends the existing report controls to a read-only role
-- (R4/R7). Any seated human or watcher in the room can report another watcher.
create or replace function public.report_watcher(p_room_id uuid, p_watcher_id uuid, p_reason text, p_details text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.room_watchers;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (private.ludo_is_seated_in_room(p_room_id) or private.ludo_is_watcher_of_room(p_room_id)) then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  select * into v_member from public.room_watchers where room_id = p_room_id and id = p_watcher_id;
  if not found or v_member.user_id = v_uid then raise exception 'PLAYER_NOT_FOUND'; end if;
  if p_reason is null or p_reason not in ('harassment','hate','sexual','spam','cheating','other')
    or char_length(p_details) > 500 then raise exception 'INVALID_REPORT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 7));
  if (select count(*) from public.player_reports where reporter_user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You''ve sent several reports recently. Please try again later.';
  end if;
  insert into public.player_reports (reporter_user_id, reported_user_id, room_id, reported_display_name, reason, details)
  values (v_uid, v_member.user_id, p_room_id, v_member.display_name, p_reason, nullif(btrim(p_details), ''));
end;
$$;
revoke execute on function public.report_watcher(uuid, uuid, text, text) from public;
grant execute on function public.report_watcher(uuid, uuid, text, text) to authenticated;
