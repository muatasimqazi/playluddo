-- Age check before online play (docs/COMPETITIVE_ROADMAP.md F0.4;
-- decisions 5, 12 and 13 in Section 12).
--
-- Online tables are 13+. Players give their birth month and year once, the
-- first time they join an online table; video (V0) will reuse the same
-- answer with an 18+ threshold. Everything here is behind the
-- 'online_age_check' feature flag, OFF by default: until it is switched on
-- (after the launch-market legal review, decision 13) no one is asked and
-- nothing is enforced. Turn it on or off with:
--
--   update private.feature_flags set enabled = true where name = 'online_age_check';
--
-- The client shows the age screen only while get_age_eligibility() reports
-- it as required, so switching the flag off is also the kill switch.

-- ---------------------------------------------------------------------------
-- Feature flags: server-side switches for features that must be able to go
-- dark without an app release (Section 15, R11; decision 18).
create table private.feature_flags (
  name text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
revoke all on private.feature_flags from public, anon, authenticated;

insert into private.feature_flags (name, enabled) values ('online_age_check', false);

create or replace function private.feature_enabled(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from private.feature_flags where name = p_name), false);
$$;
revoke execute on function private.feature_enabled(text) from public;

-- ---------------------------------------------------------------------------
-- Declarations. 13 and over: birth month and year (video needs them later).
-- Under 13 (decision 13): no birth month or year, only the month the player
-- becomes eligible. That month still reveals the birth month; the real
-- minimisation is deleting anonymous under-13 accounts (purge job below).
create table private.age_declarations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_year int check (birth_year between 1900 and 2100),
  birth_month int check (birth_month between 1 and 12),
  -- Set only for an under-13 answer.
  eligible_from date,
  declared_at timestamptz not null default now(),
  -- How the age was established; platform age signals may add values later.
  source text not null default 'self_declared' check (source in ('self_declared')),
  check (
    (birth_year is not null and birth_month is not null and eligible_from is null)
    or (birth_year is null and birth_month is null and eligible_from is not null)
  )
);
revoke all on private.age_declarations from public, anon, authenticated;

-- Decision 12: we know only month and year, so someone reaches an age on the
-- first day of the month AFTER their birth month in that year. Born March
-- 2013: 13+ from 1 April 2026.
create or replace function private.age_eligible_from(p_birth_year int, p_birth_month int, p_age int)
returns date
language sql
immutable
set search_path = ''
as $$
  select (make_date(p_birth_year + p_age, p_birth_month, 1) + interval '1 month')::date;
$$;
revoke execute on function private.age_eligible_from(int, int, int) from public;

-- What the calling player may do. Never returns birth data. eligibleFrom is
-- set only for an under-13 answer, so the device can remember when to lift
-- its block (decision 12).
create or replace function public.get_age_eligibility()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row private.age_declarations;
  v_anonymous boolean;
begin
  select * into v_row from private.age_declarations where user_id = v_uid;
  -- An under-13 marker whose month has come is spent: they're asked again.
  if v_row.eligible_from is not null and v_row.eligible_from <= current_date then
    v_row := null;
  end if;
  select coalesce(is_anonymous, true) into v_anonymous from auth.users where id = v_uid;
  return jsonb_build_object(
    'required', private.feature_enabled('online_age_check'),
    'declared', v_row.user_id is not null,
    'online', v_row.birth_year is not null,
    'video', v_row.birth_year is not null
      and not coalesce(v_anonymous, true)
      and current_date >= private.age_eligible_from(v_row.birth_year, v_row.birth_month, 18),
    'eligibleFrom', v_row.eligible_from
  );
end;
$$;
revoke execute on function public.get_age_eligibility() from public;
grant execute on function public.get_age_eligibility() to authenticated;

-- Answer once. The answer is final in the app (decision 5): changing it goes
-- through support. The one exception is a spent under-13 marker.
create or replace function public.declare_age(p_birth_year int, p_birth_month int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing private.age_declarations;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_birth_month is null or p_birth_month not between 1 and 12
    or p_birth_year is null or p_birth_year < 1900
    or make_date(p_birth_year, p_birth_month, 1) > date_trunc('month', current_date)::date
  then
    raise exception 'INVALID_BIRTH_DATE';
  end if;

  select * into v_existing from private.age_declarations where user_id = v_uid for update;
  if found then
    if v_existing.eligible_from is not null and v_existing.eligible_from <= current_date then
      delete from private.age_declarations where user_id = v_uid;
    else
      raise exception 'AGE_ALREADY_DECLARED';
    end if;
  end if;

  if current_date < private.age_eligible_from(p_birth_year, p_birth_month, 13) then
    insert into private.age_declarations (user_id, eligible_from)
    values (v_uid, private.age_eligible_from(p_birth_year, p_birth_month, 13));
  else
    insert into private.age_declarations (user_id, birth_year, birth_month)
    values (v_uid, p_birth_year, p_birth_month);
  end if;

  return public.get_age_eligibility();
end;
$$;
revoke execute on function public.declare_age(int, int) from public;
grant execute on function public.declare_age(int, int) to authenticated;

-- Called first by every way into an online table. No-op while the flag is
-- off. AGE_REQUIRED: ask the age question. AGE_RESTRICTED: under 13.
create or replace function private.require_online_eligibility()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_eligibility jsonb;
begin
  if not private.feature_enabled('online_age_check') then return; end if;
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  v_eligibility := public.get_age_eligibility();
  if not (v_eligibility->>'declared')::boolean then raise exception 'AGE_REQUIRED'; end if;
  if not (v_eligibility->>'online')::boolean then raise exception 'AGE_RESTRICTED'; end if;
end;
$$;
revoke execute on function private.require_online_eligibility() from public;

-- Decision 13: anonymous accounts with an under-13 answer, and everything
-- tied to them, are deleted after 30 days without activity. Signed-in
-- under-13 accounts are left for the legal review to decide. Seats keep
-- their history with user_id set to null (players.user_id on delete set null).
create or replace function private.purge_inactive_under13_guests()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  with stale as (
    select u.id
    from auth.users u
    join private.age_declarations d on d.user_id = u.id
    where d.eligible_from is not null
      and u.is_anonymous
      and greatest(
        d.declared_at,
        u.last_sign_in_at,
        u.updated_at,
        (select max(greatest(s.created_at, s.updated_at, s.refreshed_at)) from auth.sessions s where s.user_id = u.id)
      ) < now() - interval '30 days'
  )
  delete from auth.users u using stale where u.id = stale.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke execute on function private.purge_inactive_under13_guests() from public;

select cron.schedule(
  'purge-inactive-under13-guests',
  '17 3 * * *',
  $$select private.purge_inactive_under13_guests()$$
);

-- ---------------------------------------------------------------------------
-- Every way into an online table checks eligibility first. Each function
-- below is the current definition with that one check added after `begin`.

-- create_room: every new private or team table.
CREATE OR REPLACE FUNCTION public.create_room(p_display_name text, p_team_id uuid DEFAULT NULL::uuid, p_max_players integer DEFAULT 4)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room_id uuid;
  v_code text;
  v_player_id uuid;
  v_team_id uuid;
begin
  perform private.require_online_eligibility();
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
$function$;

-- join_room: joining by room code.
CREATE OR REPLACE FUNCTION public.join_room(p_code text, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms; v_existing_player_id uuid; v_seat_index int; v_other_seat int;
  v_player_id uuid;
begin
  perform private.require_online_eligibility();
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
$function$;

-- join_room_by_id: joining from a shared link.
CREATE OR REPLACE FUNCTION public.join_room_by_id(p_room_id uuid, p_display_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_code text;
begin
  perform private.require_online_eligibility();
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;
  select code into v_code from public.rooms where id = p_room_id;
  if v_code is null then raise exception 'ROOM_NOT_FOUND'; end if;
  return public.join_room(v_code, coalesce(nullif(btrim(p_display_name), ''), 'Player'));
end;
$function$;

-- matchmake: quick match, polled every 2s, so a player queued when the check turns on is asked within 2s.
CREATE OR REPLACE FUNCTION public.matchmake(p_game_type text, p_display_name text, p_player_count integer DEFAULT 2)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_name text := coalesce(nullif(btrim(p_display_name), ''), 'Player');
  v_me public.matchmaking_queue;
  v_found_ids uuid[];
  v_found_names text[];
  v_found int;
  v_room_id uuid;
  v_waited numeric;
begin
  perform private.require_online_eligibility();
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_game_type is null or p_game_type not in ('ludo', 'snakes_and_ladders') then
    raise exception 'INVALID_GAME_TYPE';
  end if;
  if p_player_count is null or p_player_count not between 2 and 4 then
    raise exception 'INVALID_PLAYER_COUNT';
  end if;

  select * into v_me from public.matchmaking_queue where user_id = v_uid for update;

  -- Someone else already seated us: hand over the room and leave the queue.
  if found and v_me.room_id is not null then
    delete from public.matchmaking_queue where user_id = v_uid;
    return private.matchmaking_matched(v_me.room_id);
  end if;

  -- First poll, or switched game/table size: (re)start the wait.
  if not found or v_me.game_type <> p_game_type or v_me.player_count <> p_player_count then
    insert into public.matchmaking_queue (user_id, display_name, game_type, player_count)
    values (v_uid, v_name, p_game_type, p_player_count)
    on conflict (user_id) do update
      set display_name = excluded.display_name, game_type = excluded.game_type,
          player_count = excluded.player_count,
          enqueued_at = now(), last_seen_at = now(), room_id = null
    returning * into v_me;
  else
    update public.matchmaking_queue set last_seen_at = now(), display_name = v_name
      where user_id = v_uid returning * into v_me;
  end if;

  -- Claim up to (seats - 1) other searchers for the same game and table
  -- size who are still polling, longest-waiting first.
  select coalesce(array_agg(q.user_id order by q.enqueued_at), '{}'),
         coalesce(array_agg(q.display_name order by q.enqueued_at), '{}')
    into v_found_ids, v_found_names
  from (
    select user_id, display_name, enqueued_at from public.matchmaking_queue
    where user_id <> v_uid
      and game_type = p_game_type
      and player_count = p_player_count
      and room_id is null
      and last_seen_at > now() - interval '8 seconds'
    order by enqueued_at
    limit p_player_count - 1
    for update skip locked
  ) q;
  v_found := coalesce(array_length(v_found_ids, 1), 0);
  v_waited := extract(epoch from now() - v_me.enqueued_at);

  -- Seat everyone once the table is full — or, after 45s, with whoever is
  -- here, computers taking the rest.
  if v_found = p_player_count - 1 or v_waited >= 45 then
    v_room_id := private.matchmaking_start_room(v_name, p_game_type, p_player_count, v_found_ids, v_found_names);
    update public.matchmaking_queue set room_id = v_room_id where user_id = any(v_found_ids);
    delete from public.matchmaking_queue where user_id = v_uid;
    return private.matchmaking_matched(v_room_id);
  end if;

  return jsonb_build_object(
    'status', 'waiting',
    'waitedSeconds', floor(v_waited),
    'timeoutSeconds', 45,
    'found', v_found,
    'needed', p_player_count - 1
  );
end;
$function$;

-- request_rematch: asking for a rematch.
CREATE OR REPLACE FUNCTION public.request_rematch(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
begin
  perform private.require_online_eligibility();
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'summary' then
    raise exception 'ROOM_NOT_IN_SUMMARY';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  perform private.ludo_vote_rematch(p_room_id, v_caller_player_id, 'rematch_requested');

  return jsonb_build_object('playerId', v_caller_player_id);
end;
$function$;

-- accept_rematch: accepting a rematch.
CREATE OR REPLACE FUNCTION public.accept_rematch(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_caller_player_id uuid;
begin
  perform private.require_online_eligibility();
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'summary' then
    raise exception 'ROOM_NOT_IN_SUMMARY';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'SEAT_NOT_CONTROLLED';
  end if;

  perform private.ludo_vote_rematch(p_room_id, v_caller_player_id, 'rematch_accepted_vote');

  return jsonb_build_object('playerId', v_caller_player_id);
end;
$function$;

-- reclaim_seat: taking a seat back from the computer (decision 12).
CREATE OR REPLACE FUNCTION public.reclaim_seat(p_room_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller_player_id uuid;
  v_status text;
begin
  perform private.require_online_eligibility();
  perform 1 from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  v_caller_player_id := private.ludo_caller_player_id(p_room_id);
  if v_caller_player_id is null then
    raise exception 'NOTHING_TO_RECLAIM';
  end if;

  select status into v_status from public.players where id = v_caller_player_id;
  if v_status = 'connected' then
    raise exception 'NOTHING_TO_RECLAIM';
  end if;

  update public.players
  set status = 'connected', missed_decision_count = 0, last_seen_at = now()
  where id = v_caller_player_id;

  perform private.ludo_append_event(p_room_id, 'player_reconnected', v_caller_player_id, '{}'::jsonb);
  perform private.ludo_broadcast_state(p_room_id);

  return jsonb_build_object('playerId', v_caller_player_id);
end;
$function$;

-- claim_seat: connecting to a seat you already hold.
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
  set live_connection_token = v_token, last_seen_at = now(), in_voice = false
  where id = v_caller_player_id;

  return jsonb_build_object('playerId', v_caller_player_id, 'connectionToken', v_token);
end;
$function$;
