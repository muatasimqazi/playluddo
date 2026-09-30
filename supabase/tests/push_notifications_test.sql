-- pgTAP tests for supabase/migrations/20260930140000_push_notifications.sql:
-- device registration, settings, the backgrounded-seat report, what each
-- sweep queues (and what it leaves alone), quiet hours, and the claim /
-- complete handshake with the dispatcher.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(33);

insert into auth.users (id, email, is_anonymous) values
  ('77777777-0000-0000-0000-000000000001', 'host@push.test', false),
  ('77777777-0000-0000-0000-000000000002', 'friend@push.test', false),
  ('77777777-0000-0000-0000-000000000003', 'mate@push.test', false),
  ('77777777-0000-0000-0000-000000000004', 'blocked@push.test', false),
  ('77777777-0000-0000-0000-000000000005', null, true),
  ('77777777-0000-0000-0000-000000000006', 'busy@push.test', false);

-- -------------------------------------------------------------------------
-- Off by default
-- -------------------------------------------------------------------------

select is(
  (select enabled from private.feature_flags where name = 'push_notifications'),
  false,
  'push notifications are off by default'
);

-- -------------------------------------------------------------------------
-- Devices and settings
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '77777777-0000-0000-0000-000000000005';

select lives_ok(
  $$select public.register_push_device('ios', 'guest-ios-token', null, null, 'ur', 'Asia/Karachi')$$,
  'a guest can register a device'
);
select throws_ok(
  $$select public.register_push_device('web', 'https://push.example/abc')$$,
  'P0001', 'INVALID_PUSH_DEVICE',
  'a web subscription needs its keys'
);
select throws_ok(
  $$select public.register_push_device('pager', 'x')$$,
  'P0001', 'INVALID_PUSH_DEVICE',
  'unknown platforms are rejected'
);
select is(
  public.get_notification_settings(),
  '{"turn": true, "rematch": true, "friendTable": true, "teamTable": true,
    "quietEnabled": true, "quietStart": 1320, "quietEnd": 480}'::jsonb,
  'settings default to everything on with quiet hours 22:00-08:00'
);
select is(
  public.set_notification_settings('{"friendTable": false, "quietStart": 1380}')->'friendTable',
  'false'::jsonb,
  'a partial patch switches one kind off'
);
select is(
  public.get_notification_settings()->'quietStart',
  '1380'::jsonb,
  'and keeps the rest of the patch'
);
select throws_ok(
  $$select public.set_notification_settings('{"quietEnd": 2000}')$$,
  'P0001', 'INVALID_SETTINGS',
  'quiet hours must be minutes within a day'
);
select public.set_notification_settings('{"friendTable": true, "quietStart": 1320}');

-- The same device signs in: the token moves to the account.
set local request.jwt.claim.sub = '77777777-0000-0000-0000-000000000001';
select public.register_push_device('ios', 'guest-ios-token', null, null, 'en', 'Not/AZone');
reset role;
select results_eq(
  $$select user_id, time_zone from private.push_devices where token = 'guest-ios-token'$$,
  $$values ('77777777-0000-0000-0000-000000000001'::uuid, 'UTC'::text)$$,
  'a re-registered token moves to the new account, and an unknown time zone falls back to UTC'
);

-- Everyone else gets a device (the guest a fresh one).
insert into private.push_devices (user_id, platform, token, time_zone) values
  ('77777777-0000-0000-0000-000000000002', 'android', 'friend-token', 'UTC'),
  ('77777777-0000-0000-0000-000000000003', 'android', 'mate-token', 'UTC'),
  ('77777777-0000-0000-0000-000000000004', 'android', 'blocked-token', 'UTC'),
  ('77777777-0000-0000-0000-000000000005', 'android', 'guest-token-2', 'UTC'),
  ('77777777-0000-0000-0000-000000000006', 'android', 'busy-token', 'UTC');
-- Friend and mate never have quiet hours in these tests.
insert into private.notification_settings (user_id, quiet_enabled) values
  ('77777777-0000-0000-0000-000000000002', false),
  ('77777777-0000-0000-0000-000000000003', false),
  ('77777777-0000-0000-0000-000000000004', false),
  ('77777777-0000-0000-0000-000000000006', false);

update private.feature_flags set enabled = true where name = 'push_notifications';

-- -------------------------------------------------------------------------
-- Your turn
-- -------------------------------------------------------------------------

insert into public.rooms (id, code, status) values
  ('77777777-aaaa-0000-0000-000000000001', 'PUSHT1', 'in_game');
insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('77777777-bbbb-0000-0000-000000000001', '77777777-aaaa-0000-0000-000000000001', 0,
   '77777777-0000-0000-0000-000000000005', 'Guest', 'red', 'connected', false),
  ('77777777-bbbb-0000-0000-000000000002', '77777777-aaaa-0000-0000-000000000001', 2,
   '77777777-0000-0000-0000-000000000006', 'Busy', 'yellow', 'connected', false);

update public.rooms set turn_player_id = '77777777-bbbb-0000-0000-000000000001'
where id = '77777777-aaaa-0000-0000-000000000001';
select is(
  (select turn_started_at from public.rooms where id = '77777777-aaaa-0000-0000-000000000001'),
  now(),
  'handing over the turn stamps when it started'
);

-- The turn has waited 10 seconds, but the guest is looking at the app.
update public.rooms set turn_started_at = now() - interval '10 seconds'
where id = '77777777-aaaa-0000-0000-000000000001';
select private.push_sweep();
select is(
  (select count(*) from private.push_outbox where kind = 'turn'),
  0::bigint,
  'no turn alert while the app is in front'
);

set local role authenticated;
set local request.jwt.claim.sub = '77777777-0000-0000-0000-000000000005';
select public.set_seat_backgrounded('77777777-aaaa-0000-0000-000000000001', true);
reset role;

-- Only 3 seconds in: too soon.
update public.rooms set turn_started_at = now() - interval '3 seconds'
where id = '77777777-aaaa-0000-0000-000000000001';
select private.push_sweep();
select is(
  (select count(*) from private.push_outbox where kind = 'turn'),
  0::bigint,
  'no turn alert before the turn has waited 5 seconds'
);

update public.rooms set turn_started_at = now() - interval '6 seconds'
where id = '77777777-aaaa-0000-0000-000000000001';
select private.push_sweep();
select private.push_sweep();
select results_eq(
  $$select user_id, status from private.push_outbox where kind = 'turn'$$,
  $$values ('77777777-0000-0000-0000-000000000005'::uuid, 'pending'::text)$$,
  'a backgrounded guest is queued exactly one turn alert'
);

update public.players set live_connection_token = gen_random_uuid()
where id = '77777777-bbbb-0000-0000-000000000001';
select is(
  (select count(*) from private.seat_backgrounded where player_id = '77777777-bbbb-0000-0000-000000000001'),
  0::bigint,
  'a fresh connection to the seat clears the backgrounded flag'
);
-- Back to the background for the claim tests below.
insert into private.seat_backgrounded (player_id) values ('77777777-bbbb-0000-0000-000000000001');

-- -------------------------------------------------------------------------
-- Rematch
-- -------------------------------------------------------------------------

insert into public.rooms (id, code, status, rematch_requested_at) values
  ('77777777-aaaa-0000-0000-000000000002', 'PUSHR1', 'summary', now() - interval '5 seconds');
insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot, rematch_ready) values
  ('77777777-bbbb-0000-0000-000000000003', '77777777-aaaa-0000-0000-000000000002', 0,
   '77777777-0000-0000-0000-000000000001', 'Host', 'red', 'connected', false, true),
  ('77777777-bbbb-0000-0000-000000000004', '77777777-aaaa-0000-0000-000000000002', 2,
   '77777777-0000-0000-0000-000000000003', 'Mate', 'yellow', 'disconnected', false, false);
insert into public.match_events (room_id, sequence, event_type, player_id, created_at) values
  ('77777777-aaaa-0000-0000-000000000002', 1, 'rematch_requested', '77777777-bbbb-0000-0000-000000000003',
   now() - interval '5 seconds');

select private.push_sweep();
select results_eq(
  $$select user_id, data->>'name' from private.push_outbox where kind = 'rematch'$$,
  $$values ('77777777-0000-0000-0000-000000000003'::uuid, 'Host'::text)$$,
  'a rematch request reaches only the away player who has not voted, naming who asked'
);

-- -------------------------------------------------------------------------
-- A table opens
-- -------------------------------------------------------------------------

insert into public.teams (id, name, owner_user_id) values
  ('77777777-cccc-0000-0000-000000000001', 'Tuesday Club', '77777777-0000-0000-0000-000000000001');
insert into public.team_members (team_id, user_id, display_name) values
  ('77777777-cccc-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'Host'),
  ('77777777-cccc-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', 'Mate');
-- Friend, Mate (also on the team), Blocked and Busy are all friends of Host.
insert into public.friendships (user_low, user_high, status, requested_by) values
  ('77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000002', 'accepted', '77777777-0000-0000-0000-000000000001'),
  ('77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000003', 'accepted', '77777777-0000-0000-0000-000000000001'),
  ('77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000004', 'accepted', '77777777-0000-0000-0000-000000000001'),
  ('77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000006', 'accepted', '77777777-0000-0000-0000-000000000001');
insert into public.player_blocks (blocker_user_id, blocked_user_id) values
  ('77777777-0000-0000-0000-000000000004', '77777777-0000-0000-0000-000000000001');
-- Busy is mid-game elsewhere.
insert into public.rooms (id, code, status) values ('77777777-aaaa-0000-0000-000000000003', 'PUSHB1', 'in_game');
insert into public.players (room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('77777777-aaaa-0000-0000-000000000003', 0, '77777777-0000-0000-0000-000000000006', 'Busy', 'red', 'connected', false);

insert into public.rooms (id, code, status, team_id, created_at) values
  ('77777777-aaaa-0000-0000-000000000004', 'PUSHO1', 'lobby', '77777777-cccc-0000-0000-000000000001', now() - interval '10 seconds');
insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('77777777-bbbb-0000-0000-000000000005', '77777777-aaaa-0000-0000-000000000004', 0,
   '77777777-0000-0000-0000-000000000001', 'Host', 'red', 'connected', false);
update public.rooms set host_player_id = '77777777-bbbb-0000-0000-000000000005'
where id = '77777777-aaaa-0000-0000-000000000004';

-- A quick-match room opened by the same host announces nothing.
insert into public.rooms (id, code, status, matchmade, created_at) values
  ('77777777-aaaa-0000-0000-000000000005', 'PUSHQ1', 'lobby', true, now() - interval '10 seconds');
insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('77777777-bbbb-0000-0000-000000000006', '77777777-aaaa-0000-0000-000000000005', 0,
   '77777777-0000-0000-0000-000000000001', 'Host', 'red', 'connected', false);
update public.rooms set host_player_id = '77777777-bbbb-0000-0000-000000000006'
where id = '77777777-aaaa-0000-0000-000000000005';

select private.push_sweep();

select results_eq(
  $$select user_id, kind, data->>'team' from private.push_outbox
    where room_id = '77777777-aaaa-0000-0000-000000000004' and status = 'pending'
    order by user_id$$,
  $$values ('77777777-0000-0000-0000-000000000002'::uuid, 'friend_table'::text, 'Tuesday Club'::text),
           ('77777777-0000-0000-0000-000000000003'::uuid, 'team_table'::text, 'Tuesday Club'::text)$$,
  'a friend gets a friend alert and a teammate who is also a friend gets only the team alert'
);
select is(
  (select count(*) from private.push_outbox where user_id = '77777777-0000-0000-0000-000000000004'),
  0::bigint,
  'someone who blocked the host is never told'
);
select is(
  (select count(*) from private.push_outbox where user_id = '77777777-0000-0000-0000-000000000006'),
  0::bigint,
  'a friend mid-game elsewhere is not interrupted'
);
select is(
  (select count(*) from private.push_outbox where room_id = '77777777-aaaa-0000-0000-000000000005'),
  0::bigint,
  'quick-match rooms are never announced'
);

select private.push_sweep();
select is(
  (select count(*) from private.push_outbox where room_id = '77777777-aaaa-0000-0000-000000000004' and status = 'pending'),
  2::bigint,
  'a table is announced once'
);

-- A second table from the same host, while the first friend alert is fresh.
update private.push_outbox set status = 'sent'
where room_id = '77777777-aaaa-0000-0000-000000000004' and status = 'pending';
insert into public.rooms (id, code, status, created_at) values
  ('77777777-aaaa-0000-0000-000000000006', 'PUSHO2', 'lobby', now() - interval '10 seconds');
insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('77777777-bbbb-0000-0000-000000000007', '77777777-aaaa-0000-0000-000000000006', 0,
   '77777777-0000-0000-0000-000000000001', 'Host', 'red', 'connected', false);
update public.rooms set host_player_id = '77777777-bbbb-0000-0000-000000000007'
where id = '77777777-aaaa-0000-0000-000000000006';
select private.push_sweep();
select is(
  (select count(*) from private.push_outbox
   where room_id = '77777777-aaaa-0000-0000-000000000006'
     and user_id = '77777777-0000-0000-0000-000000000002' and status = 'pending'),
  0::bigint,
  'friends hear from the same host at most once every 30 minutes'
);
-- (Mate's alert for this table was a team alert last time, so they do get
-- this one; it isn't part of the claim tests below.)
update private.push_outbox set status = 'skipped'
where room_id = '77777777-aaaa-0000-0000-000000000006' and status = 'pending';

-- A guest's table is never announced.
insert into public.rooms (id, code, status, created_at) values
  ('77777777-aaaa-0000-0000-000000000007', 'PUSHG1', 'lobby', now() - interval '10 seconds');
insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot) values
  ('77777777-bbbb-0000-0000-000000000008', '77777777-aaaa-0000-0000-000000000007', 0,
   '77777777-0000-0000-0000-000000000005', 'Guest', 'red', 'connected', false);
update public.rooms set host_player_id = '77777777-bbbb-0000-0000-000000000008'
where id = '77777777-aaaa-0000-0000-000000000007';
select private.push_sweep();
select is(
  (select count(*) from private.push_outbox where room_id = '77777777-aaaa-0000-0000-000000000007'),
  0::bigint,
  'a guest opening a table notifies no one'
);

-- -------------------------------------------------------------------------
-- Claiming
-- -------------------------------------------------------------------------

-- Re-queue the two table alerts, and have Friend switch friend alerts off.
update private.push_outbox set status = 'pending'
where room_id = '77777777-aaaa-0000-0000-000000000004' and status = 'sent';
update private.notification_settings set friend_table = false
where user_id = '77777777-0000-0000-0000-000000000002';

set local role authenticated;
select throws_ok(
  $$select public.push_claim(10)$$,
  '42501', null,
  'clients cannot claim the outbox'
);
reset role;

create temporary table claimed as select public.push_claim(100) as messages;

select is(
  (select jsonb_array_length(messages) from claimed),
  3,
  'the claim yields the turn, rematch and team alerts, one per device'
);
select is(
  (select m->>'token' from claimed, jsonb_array_elements(messages) m where m->>'kind' = 'turn'),
  'guest-token-2',
  'the turn alert goes to the guest''s own device'
);
select is(
  (select status from private.push_outbox
   where user_id = '77777777-0000-0000-0000-000000000002' and kind = 'friend_table'
     and room_id = '77777777-aaaa-0000-0000-000000000004'),
  'skipped',
  'a switched-off kind is skipped, not sent'
);
select is(
  (select count(*) from private.push_outbox where status = 'sending'),
  3::bigint,
  'claimed items are marked as sending'
);
select is(
  jsonb_array_length(public.push_claim(100)),
  0,
  'a claimed item is not handed out twice'
);

select public.push_complete(
  (select jsonb_agg(jsonb_build_object('outboxId', (m->>'outboxId')::bigint, 'ok', m->>'kind' <> 'rematch'))
   from claimed, jsonb_array_elements(messages) m),
  array['mate-token']
);
select results_eq(
  $$select kind, status from private.push_outbox where status in ('sent', 'failed') and kind in ('turn', 'rematch')
    order by kind$$,
  $$values ('rematch'::text, 'failed'::text), ('turn'::text, 'sent'::text)$$,
  'completion records what was delivered and what failed'
);
select is(
  (select count(*) from private.push_devices where token = 'mate-token'),
  0::bigint,
  'a token the push service reports dead is forgotten'
);

-- -------------------------------------------------------------------------
-- Staleness and quiet hours
-- -------------------------------------------------------------------------

-- The turn moved on before dispatch: the alert is dropped.
insert into private.push_outbox (dedupe_key, user_id, kind, room_id, data) values
  ('turn:stale', '77777777-0000-0000-0000-000000000005', 'turn', '77777777-aaaa-0000-0000-000000000001',
   jsonb_build_object('playerId', '77777777-bbbb-0000-0000-000000000001', 'turnStartedAt', now() - interval '1 hour'));
select is(
  jsonb_array_length(public.push_claim(100)),
  0,
  'an alert for a turn that has moved on is not sent'
);

-- Quiet hours covering the whole day except the minute after this one, so
-- the window starts after "now" and wraps past midnight to include it.
update private.notification_settings
set quiet_enabled = true,
    quiet_start = ((extract(hour from now() at time zone 'UTC') * 60 + extract(minute from now() at time zone 'UTC'))::int + 2) % 1440,
    quiet_end = ((extract(hour from now() at time zone 'UTC') * 60 + extract(minute from now() at time zone 'UTC'))::int + 1) % 1440
where user_id = '77777777-0000-0000-0000-000000000002';
select ok(
  private.push_quiet_now('77777777-0000-0000-0000-000000000002', 'UTC'),
  'a window that wraps past midnight is honoured'
);
select ok(
  not private.push_quiet_now('77777777-0000-0000-0000-000000000003', 'UTC'),
  'with quiet hours off it is never quiet'
);

select * from finish();
rollback;
