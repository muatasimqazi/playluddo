-- Push notifications (docs/COMPETITIVE_ROADMAP.md F1.7; Section 15, R6).
--
-- Four kinds, each switchable per account, never marketing:
--   turn          "Your turn": only while the player's app is in the
--                 background (or their seat is disconnected) and the turn
--                 has waited more than 5 seconds.
--   rematch       Someone asked for a rematch; the 60-second vote window
--                 (ludo_vote_rematch) is running and you haven't voted.
--   friend_table  An accepted friend opened a table (rate-limited).
--   team_table    A teammate opened a table for your team.
--
-- Guests (anonymous sessions) can register a device, but only turn and
-- rematch alerts ever reach them: friend and team alerts need an account on
-- both ends by construction. Quiet hours (default 22:00-08:00 in the
-- device's time zone) hold back friend and team alerts; turn and rematch
-- alerts belong to a game the player is in right now, so they still send.
--
-- Flow: a pg_cron sweep every 2 seconds queues what's due into
-- private.push_outbox (each item with a unique dedupe key, so a retry never
-- sends twice), then, if anything is pending, wakes the push-dispatch Edge
-- Function through pg_net. The function claims items with push_claim (which
-- re-checks that each one is still true, applies settings and quiet hours,
-- and fans out to the recipient's devices), sends through APNs, FCM or Web
-- Push, and reports back with push_complete.
--
-- Everything is behind the 'push_notifications' feature flag, OFF by
-- default. Before switching it on, store the dispatcher's URL and shared
-- secret in Vault (the function reads the same secret as
-- PUSH_DISPATCH_SECRET):
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/push-dispatch', 'push_dispatch_url');
--   select vault.create_secret('<random secret>', 'push_dispatch_secret');
--   update private.feature_flags set enabled = true where name = 'push_notifications';

create extension if not exists pg_net;

insert into private.feature_flags (name, enabled) values ('push_notifications', false);

-- ---------------------------------------------------------------------------
-- Devices. One row per push destination: an APNs device token (iOS), an FCM
-- registration token (Android) or a Web Push endpoint with its keys. A token
-- belongs to whoever registered it last, so a device that signs in moves to
-- the new account instead of notifying the old guest.
create table private.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  token text not null check (length(token) between 1 and 2048),
  -- Web Push subscription keys (RFC 8291); null for native tokens.
  web_p256dh text,
  web_auth text,
  locale text not null default 'en',
  time_zone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, token),
  check (platform <> 'web' or (web_p256dh is not null and web_auth is not null))
);
create index push_devices_user_idx on private.push_devices(user_id);
revoke all on private.push_devices from public, anon, authenticated;

-- Settings. A missing row means the defaults: everything on, quiet hours
-- 22:00-08:00. Stored server-side (not in user_metadata like the other
-- preferences) because the sender has to read them, guests included.
create table private.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  turn boolean not null default true,
  rematch boolean not null default true,
  friend_table boolean not null default true,
  team_table boolean not null default true,
  quiet_enabled boolean not null default true,
  -- Minutes after local midnight. start > end wraps past midnight.
  quiet_start smallint not null default 1320 check (quiet_start between 0 and 1439),
  quiet_end smallint not null default 480 check (quiet_end between 0 and 1439),
  updated_at timestamptz not null default now()
);
revoke all on private.notification_settings from public, anon, authenticated;

-- Which seats have their app in the background. Kept out of public.players
-- so other players at the table never see it, and so it doesn't churn the
-- room broadcast.
create table private.seat_backgrounded (
  player_id uuid primary key references public.players(id) on delete cascade,
  since timestamptz not null default now()
);
revoke all on private.seat_backgrounded from public, anon, authenticated;

-- A fresh connection to the seat (claim_seat rotates live_connection_token)
-- means the app is open on the table, even if the client's own "back in
-- front" report was lost, e.g. on a cold start from a notification.
create or replace function private.clear_seat_backgrounded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.seat_backgrounded where player_id = new.id;
  return new;
end;
$$;

create trigger players_clear_seat_backgrounded
after update of live_connection_token on public.players
for each row
when (new.live_connection_token is distinct from old.live_connection_token)
execute function private.clear_seat_backgrounded();

-- When the current turn started, so "waited more than 5 seconds" needs no
-- guessing from the deadline (turn lengths vary by house rule).
alter table public.rooms add column turn_started_at timestamptz;

create or replace function private.stamp_turn_started()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.turn_player_id is distinct from old.turn_player_id then
    new.turn_started_at := case when new.turn_player_id is null then null else now() end;
  end if;
  return new;
end;
$$;

create trigger rooms_stamp_turn_started
before update of turn_player_id on public.rooms
for each row execute function private.stamp_turn_started();

-- The outbox. data carries what the copy needs (names) and what push_claim
-- re-checks (the turn or vote it was queued for).
create table private.push_outbox (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('turn', 'rematch', 'friend_table', 'team_table')),
  room_id uuid references public.rooms(id) on delete cascade,
  -- The account that caused a social alert, for per-sender rate limits.
  sender_user_id uuid references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index push_outbox_pending_idx on private.push_outbox(id) where status in ('pending', 'sending');
create index push_outbox_recipient_idx on private.push_outbox(user_id, kind, created_at);
revoke all on private.push_outbox from public, anon, authenticated;

-- Last time the sweep woke the dispatcher, so it isn't called on every tick
-- while a slow batch is still being sent.
create table private.push_dispatch_state (
  id boolean primary key default true check (id),
  last_kick_at timestamptz
);
insert into private.push_dispatch_state (id) values (true);
revoke all on private.push_dispatch_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client RPCs

-- IANA zone names only; anything Postgres doesn't know falls back to UTC.
create or replace function private.push_valid_time_zone(p_time_zone text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select name from pg_catalog.pg_timezone_names where name = p_time_zone limit 1),
    'UTC'
  );
$$;
revoke execute on function private.push_valid_time_zone(text) from public;

create or replace function public.register_push_device(
  p_platform text,
  p_token text,
  p_web_p256dh text default null,
  p_web_auth text default null,
  p_locale text default 'en',
  p_time_zone text default 'UTC'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if p_platform not in ('ios', 'android', 'web') or coalesce(length(p_token), 0) not between 1 and 2048 then
    raise exception 'INVALID_PUSH_DEVICE';
  end if;
  if p_platform = 'web' and (p_web_p256dh is null or p_web_auth is null
      or p_token !~ '^https://') then
    raise exception 'INVALID_PUSH_DEVICE';
  end if;

  insert into private.push_devices (user_id, platform, token, web_p256dh, web_auth, locale, time_zone)
  values (
    (select auth.uid()), p_platform, p_token, p_web_p256dh, p_web_auth,
    left(coalesce(nullif(p_locale, ''), 'en'), 16),
    private.push_valid_time_zone(p_time_zone)
  )
  on conflict (platform, token) do update
  set user_id = excluded.user_id,
      web_p256dh = excluded.web_p256dh,
      web_auth = excluded.web_auth,
      locale = excluded.locale,
      time_zone = excluded.time_zone,
      updated_at = now();

  -- A handful of devices per account is plenty; forget the stalest.
  delete from private.push_devices
  where user_id = (select auth.uid())
    and id not in (
      select id from private.push_devices
      where user_id = (select auth.uid())
      order by updated_at desc
      limit 10
    );
end;
$$;
revoke execute on function public.register_push_device(text, text, text, text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text, text, text, text) to authenticated;

create or replace function public.unregister_push_device(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.push_devices where token = p_token and user_id = (select auth.uid());
$$;
revoke execute on function public.unregister_push_device(text) from public, anon;
grant execute on function public.unregister_push_device(text) to authenticated;

create or replace function private.notification_settings_json(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'turn', coalesce(s.turn, true),
    'rematch', coalesce(s.rematch, true),
    'friendTable', coalesce(s.friend_table, true),
    'teamTable', coalesce(s.team_table, true),
    'quietEnabled', coalesce(s.quiet_enabled, true),
    'quietStart', coalesce(s.quiet_start, 1320),
    'quietEnd', coalesce(s.quiet_end, 480)
  )
  from (select 1) one
  left join private.notification_settings s on s.user_id = p_user_id;
$$;
revoke execute on function private.notification_settings_json(uuid) from public;

create or replace function public.get_notification_settings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  return private.notification_settings_json((select auth.uid()));
end;
$$;
revoke execute on function public.get_notification_settings() from public, anon;
grant execute on function public.get_notification_settings() to authenticated;

-- Takes a partial patch with the same keys get_notification_settings returns.
create or replace function public.set_notification_settings(p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current jsonb;
  v_next jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if jsonb_typeof(p_settings) <> 'object' then
    raise exception 'INVALID_SETTINGS';
  end if;

  v_current := private.notification_settings_json((select auth.uid()));
  v_next := v_current || (
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    from jsonb_each(p_settings)
    where key in ('turn', 'rematch', 'friendTable', 'teamTable', 'quietEnabled', 'quietStart', 'quietEnd')
  );

  if jsonb_typeof(v_next->'turn') <> 'boolean' or jsonb_typeof(v_next->'rematch') <> 'boolean'
     or jsonb_typeof(v_next->'friendTable') <> 'boolean' or jsonb_typeof(v_next->'teamTable') <> 'boolean'
     or jsonb_typeof(v_next->'quietEnabled') <> 'boolean'
     or jsonb_typeof(v_next->'quietStart') <> 'number' or jsonb_typeof(v_next->'quietEnd') <> 'number'
     or (v_next->>'quietStart')::numeric not between 0 and 1439
     or (v_next->>'quietEnd')::numeric not between 0 and 1439 then
    raise exception 'INVALID_SETTINGS';
  end if;

  insert into private.notification_settings as s
    (user_id, turn, rematch, friend_table, team_table, quiet_enabled, quiet_start, quiet_end)
  values (
    (select auth.uid()),
    (v_next->>'turn')::boolean, (v_next->>'rematch')::boolean,
    (v_next->>'friendTable')::boolean, (v_next->>'teamTable')::boolean,
    (v_next->>'quietEnabled')::boolean,
    (v_next->>'quietStart')::numeric::smallint, (v_next->>'quietEnd')::numeric::smallint
  )
  on conflict (user_id) do update
  set turn = excluded.turn, rematch = excluded.rematch,
      friend_table = excluded.friend_table, team_table = excluded.team_table,
      quiet_enabled = excluded.quiet_enabled,
      quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end,
      updated_at = now();

  return private.notification_settings_json((select auth.uid()));
end;
$$;
revoke execute on function public.set_notification_settings(jsonb) from public, anon;
grant execute on function public.set_notification_settings(jsonb) to authenticated;

-- The client reports its app going to the background (and coming back) while
-- it holds a seat. A no-op for a caller without a seat in the room.
create or replace function public.set_seat_backgrounded(p_room_id uuid, p_backgrounded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
begin
  v_player_id := private.ludo_caller_player_id(p_room_id);
  if v_player_id is null then
    return;
  end if;
  if p_backgrounded then
    insert into private.seat_backgrounded (player_id) values (v_player_id)
    on conflict (player_id) do nothing;
  else
    delete from private.seat_backgrounded where player_id = v_player_id;
  end if;
end;
$$;
revoke execute on function public.set_seat_backgrounded(uuid, boolean) from public, anon;
grant execute on function public.set_seat_backgrounded(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Queueing

-- Seats whose player is away from the app: backgrounded, or their connection
-- has dropped but no computer has taken over yet.
create or replace function private.push_seat_away(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players p
    where p.id = p_player_id
      and p.is_bot = false
      and p.user_id is not null
      and (p.status = 'disconnected'
           or (p.status = 'connected'
               and exists (select 1 from private.seat_backgrounded b where b.player_id = p.id)))
  );
$$;
revoke execute on function private.push_seat_away(uuid) from public;

create or replace function private.push_enqueue_turns()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.push_outbox (dedupe_key, user_id, kind, room_id, data)
  select
    'turn:' || r.id || ':' || p.id || ':' || extract(epoch from r.turn_started_at),
    p.user_id, 'turn', r.id,
    jsonb_build_object(
      'playerId', p.id,
      'turnStartedAt', r.turn_started_at,
      'gameType', r.game_type
    )
  from public.rooms r
  join public.players p on p.id = r.turn_player_id
  where r.status = 'in_game'
    and r.turn_started_at between now() - interval '2 minutes' and now() - interval '5 seconds'
    and private.push_seat_away(p.id)
  on conflict (dedupe_key) do nothing;
$$;
revoke execute on function private.push_enqueue_turns() from public;

create or replace function private.push_enqueue_rematches()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.push_outbox (dedupe_key, user_id, kind, room_id, data)
  select
    'rematch:' || r.id || ':' || p.id || ':' || extract(epoch from r.rematch_requested_at),
    p.user_id, 'rematch', r.id,
    jsonb_build_object(
      'playerId', p.id,
      'requestedAt', r.rematch_requested_at,
      'name', coalesce((
        select asker.display_name
        from public.match_events e
        join public.players asker on asker.id = e.player_id
        where e.room_id = r.id
          and e.event_type = 'rematch_requested'
          and e.created_at >= r.rematch_requested_at
        order by e.sequence
        limit 1
      ), '')
    )
  from public.rooms r
  join public.players p on p.room_id = r.id
  where r.status = 'summary'
    and r.rematch_requested_at > now() - interval '50 seconds'
    and p.rematch_ready = false
    and private.push_seat_away(p.id)
  on conflict (dedupe_key) do nothing;
$$;
revoke execute on function private.push_enqueue_rematches() from public;

-- A signed-in player opened an ordinary table: not a Party room, quick
-- match or tournament table. Waiting a few seconds after creation lets
-- matchmaking mark its rooms first. Teammates hear about a team table;
-- accepted friends hear about any table, at most once per friend every 30
-- minutes and 4 social alerts an hour in all. Nobody is told who is already
-- at the table, mid-game elsewhere, or blocked either way.
create or replace function private.push_enqueue_table_openings()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room record;
begin
  for v_room in
    select r.id, r.team_id, host.user_id as host_user_id, host.display_name as host_name, t.name as team_name
    from public.rooms r
    join public.players host on host.id = r.host_player_id
    join auth.users u on u.id = host.user_id and not coalesce(u.is_anonymous, false)
    left join public.teams t on t.id = r.team_id
    where r.status = 'lobby'
      and r.created_at between now() - interval '2 minutes' and now() - interval '5 seconds'
      and not r.is_party
      and not r.matchmade
      and r.tournament_table_id is null
      and not exists (
        select 1 from private.push_outbox o
        where o.dedupe_key = 'opened:' || r.id
      )
  loop
    -- Marks the room as announced, whoever turns out to be told.
    insert into private.push_outbox (dedupe_key, user_id, kind, room_id, sender_user_id, status, finished_at)
    values ('opened:' || v_room.id, v_room.host_user_id, 'friend_table', v_room.id, v_room.host_user_id, 'skipped', now())
    on conflict (dedupe_key) do nothing;

    with recipients as (
      select tm.user_id, 'team_table'::text as kind
      from public.team_members tm
      where v_room.team_id is not null
        and tm.team_id = v_room.team_id
        and tm.user_id <> v_room.host_user_id
      union
      select case when f.user_low = v_room.host_user_id then f.user_high else f.user_low end, 'friend_table'
      from public.friendships f
      where f.status = 'accepted'
        and (f.user_low = v_room.host_user_id or f.user_high = v_room.host_user_id)
    ),
    -- A teammate who is also a friend gets the team alert only.
    chosen as (
      select distinct on (user_id) user_id, kind
      from recipients
      order by user_id, (kind = 'team_table') desc
    )
    insert into private.push_outbox (dedupe_key, user_id, kind, room_id, sender_user_id, data)
    select
      'table:' || v_room.id || ':' || c.user_id,
      c.user_id, c.kind, v_room.id, v_room.host_user_id,
      jsonb_build_object('name', v_room.host_name, 'team', coalesce(v_room.team_name, ''))
    from chosen c
    where not private.blocked_between(c.user_id, v_room.host_user_id)
      and not exists (
        select 1 from public.players p
        join public.rooms r2 on r2.id = p.room_id
        where p.user_id = c.user_id
          and (p.room_id = v_room.id or r2.status = 'in_game')
          and r2.status in ('lobby', 'in_game')
      )
      and (c.kind = 'team_table' or not exists (
        select 1 from private.push_outbox o
        where o.user_id = c.user_id
          and o.sender_user_id = v_room.host_user_id
          and o.kind = 'friend_table'
          and o.status <> 'skipped'
          and o.created_at > now() - interval '30 minutes'
      ))
      and (
        select count(*) from private.push_outbox o
        where o.user_id = c.user_id
          and o.kind in ('friend_table', 'team_table')
          and o.status <> 'skipped'
          and o.created_at > now() - interval '1 hour'
      ) < 4
    on conflict (dedupe_key) do nothing;
  end loop;
end;
$$;
revoke execute on function private.push_enqueue_table_openings() from public;

-- Wakes push-dispatch. Without the URL and secret in Vault this does nothing,
-- and items wait in the outbox until they go stale.
create or replace function private.push_kick_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  update private.push_dispatch_state set last_kick_at = now();
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;
revoke execute on function private.push_kick_dispatcher() from public;

create or replace function private.push_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.feature_enabled('push_notifications') then
    return;
  end if;

  perform private.push_enqueue_turns();
  perform private.push_enqueue_rematches();
  perform private.push_enqueue_table_openings();

  -- Anything still pending after a minute is no longer worth sending.
  update private.push_outbox
  set status = 'skipped', finished_at = now()
  where status = 'pending' and created_at < now() - interval '1 minute';
  -- A claim the dispatcher never finished (it crashed or timed out).
  update private.push_outbox
  set status = 'failed', finished_at = now()
  where status = 'sending' and claimed_at < now() - interval '2 minutes';
  -- Keep a day of history: enough for rate limits and debugging.
  delete from private.push_outbox
  where id in (
    select id from private.push_outbox
    where created_at < now() - interval '1 day'
    limit 500
  );

  if exists (select 1 from private.push_outbox where status = 'pending')
     and coalesce((select last_kick_at from private.push_dispatch_state), '-infinity') < now() - interval '3 seconds' then
    perform private.push_kick_dispatcher();
  end if;
end;
$$;
revoke execute on function private.push_sweep() from public;

select cron.schedule('push-sweep', '2 seconds', $$select private.push_sweep()$$);

-- ---------------------------------------------------------------------------
-- Dispatcher RPCs (service role only)

-- True while local time on the device falls inside the quiet window.
create or replace function private.push_quiet_now(p_user_id uuid, p_time_zone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select
      coalesce(ns.quiet_enabled, true) as enabled,
      coalesce(ns.quiet_start, 1320) as qs,
      coalesce(ns.quiet_end, 480) as qe,
      (extract(hour from now() at time zone p_time_zone) * 60
        + extract(minute from now() at time zone p_time_zone))::int as m
    from (select 1) one
    left join private.notification_settings ns on ns.user_id = p_user_id
  )
  select enabled and qs <> qe and case
    when qs < qe then m >= qs and m < qe
    else m >= qs or m < qe
  end
  from s;
$$;
revoke execute on function private.push_quiet_now(uuid, text) from public;

-- Claims up to p_limit pending items and returns one message per device.
-- Items that are no longer true, switched off, or have no device are
-- skipped here rather than sent.
create or replace function public.push_claim(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item private.push_outbox;
  v_settings jsonb;
  v_still_true boolean;
  v_messages jsonb := '[]'::jsonb;
  v_device_messages jsonb;
begin
  for v_item in
    select * from private.push_outbox
    where status = 'pending'
    order by id
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  loop
    v_settings := private.notification_settings_json(v_item.user_id);

    v_still_true := case v_item.kind
      when 'turn' then exists (
        select 1 from public.rooms r
        where r.id = v_item.room_id
          and r.status = 'in_game'
          and r.turn_player_id = (v_item.data->>'playerId')::uuid
          and r.turn_started_at = (v_item.data->>'turnStartedAt')::timestamptz
      ) and private.push_seat_away((v_item.data->>'playerId')::uuid)
      when 'rematch' then exists (
        select 1 from public.rooms r
        join public.players p on p.id = (v_item.data->>'playerId')::uuid and p.room_id = r.id
        where r.id = v_item.room_id
          and r.status = 'summary'
          and r.rematch_requested_at = (v_item.data->>'requestedAt')::timestamptz
          and p.rematch_ready = false
      )
      else exists (
        select 1 from public.rooms r where r.id = v_item.room_id and r.status = 'lobby'
      )
    end;

    if not v_still_true or not coalesce((v_settings->>(case v_item.kind
        when 'turn' then 'turn'
        when 'rematch' then 'rematch'
        when 'friend_table' then 'friendTable'
        else 'teamTable' end))::boolean, true) then
      update private.push_outbox set status = 'skipped', finished_at = now() where id = v_item.id;
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'outboxId', v_item.id,
      'kind', v_item.kind,
      'roomId', v_item.room_id,
      'data', v_item.data,
      'platform', d.platform,
      'token', d.token,
      'webP256dh', d.web_p256dh,
      'webAuth', d.web_auth,
      'locale', d.locale
    )), '[]'::jsonb)
    into v_device_messages
    from private.push_devices d
    where d.user_id = v_item.user_id
      -- Quiet hours hold back social alerts only.
      and (v_item.kind in ('turn', 'rematch') or not private.push_quiet_now(v_item.user_id, d.time_zone));

    if jsonb_array_length(v_device_messages) = 0 then
      update private.push_outbox set status = 'skipped', finished_at = now() where id = v_item.id;
      continue;
    end if;

    update private.push_outbox
    set status = 'sending', claimed_at = now(), attempts = attempts + 1
    where id = v_item.id;
    v_messages := v_messages || v_device_messages;
  end loop;

  return v_messages;
end;
$$;
revoke execute on function public.push_claim(int) from public, anon, authenticated;
grant execute on function public.push_claim(int) to service_role;

-- p_results: [{ outboxId, ok }]. An item counts as sent if any of its devices
-- took it. p_dead_tokens: tokens the push service says are gone for good.
create or replace function public.push_complete(p_results jsonb, p_dead_tokens text[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.push_outbox o
  set status = case when r.any_ok then 'sent' else 'failed' end,
      finished_at = now()
  from (
    select (x->>'outboxId')::bigint as id, bool_or(coalesce((x->>'ok')::boolean, false)) as any_ok
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x
    group by 1
  ) r
  where o.id = r.id and o.status = 'sending';

  delete from private.push_devices where token = any(coalesce(p_dead_tokens, '{}'));
end;
$$;
revoke execute on function public.push_complete(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.push_complete(jsonb, text[]) to service_role;
