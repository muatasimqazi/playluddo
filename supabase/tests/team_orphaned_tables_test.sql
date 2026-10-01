-- pgTAP tests for supabase/migrations/20260930160000_team_orphaned_tables.sql:
-- a team's open table is only one someone has used lately, says whether the
-- caller is seated, and a paused game everyone left is closed out.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(8);

create temporary table orphan_state (key text primary key, value jsonb);
grant select, insert on orphan_state to authenticated;

insert into auth.users (id, email, is_anonymous) values
  ('dddddddd-0000-0000-0000-000000000001', 'owner@orphan.test', false),
  ('dddddddd-0000-0000-0000-000000000002', 'mate@orphan.test', false);

create function pg_temp.team() returns uuid language sql as $$
  select (value->0->>'id')::uuid from orphan_state where key = 'team';
$$;
create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from orphan_state where key = 'room';
$$;
create function pg_temp.active(p_user uuid) returns jsonb language sql as $$
  select nullif(private.luddo_my_teams_json(p_user)->0->'activeRoom', 'null'::jsonb);
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000001';
insert into orphan_state values ('team', public.create_team('Night Owls', 'Olive'));
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000002';
select public.join_team((select value->0->>'inviteCode' from orphan_state where key = 'team'), 'Max');
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000001';
insert into orphan_state values ('room', public.create_room('Olive', pg_temp.team()));
reset role;

select is(
  (pg_temp.active('dddddddd-0000-0000-0000-000000000001')->>'roomId')::uuid,
  pg_temp.room(),
  'a fresh team table is the open one'
);
select is(
  pg_temp.active('dddddddd-0000-0000-0000-000000000001')->>'isSeated',
  'true',
  'and says the player who sat down is seated'
);
select results_eq(
  $$select pg_temp.active('dddddddd-0000-0000-0000-000000000002')->>'isSeated',
           (pg_temp.active('dddddddd-0000-0000-0000-000000000002')->>'maxPlayers')::int$$,
  $$values ('false'::text, 4)$$,
  'a teammate who isn''t seated sees that, and how many seats it has'
);

-- Everyone walked away an hour ago.
update public.rooms set created_at = now() - interval '2 hours' where id = pg_temp.room();
update public.players set last_seen_at = now() - interval '1 hour' where room_id = pg_temp.room();
select is(
  pg_temp.active('dddddddd-0000-0000-0000-000000000002'),
  null,
  'a table nobody has used for half an hour is no longer the team''s open table'
);

-- Someone comes back to it.
update public.players set last_seen_at = now() where room_id = pg_temp.room();
select is(
  (pg_temp.active('dddddddd-0000-0000-0000-000000000002')->>'roomId')::uuid,
  pg_temp.room(),
  'and it is again once someone is back at it'
);

-- -------------------------------------------------------------------------
-- A paused game everyone left is closed out
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'dddddddd-0000-0000-0000-000000000001';
select public.fill_bot(pg_temp.room(), 1);
select public.start_match(pg_temp.room());
reset role;
update public.rooms set paused_at = now() - interval '2 hours', paused_for_player_id = null where id = pg_temp.room();
update public.players set last_seen_at = now() - interval '10 minutes' where room_id = pg_temp.room();
select public.sweep_expired_turns();
select is(
  (select status from public.rooms where id = pg_temp.room()),
  'in_game',
  'a paused game someone was at in the last hour is left alone'
);

update public.players set last_seen_at = now() - interval '2 hours' where room_id = pg_temp.room();
select public.sweep_expired_turns();
select is(
  (select status from public.rooms where id = pg_temp.room()),
  'abandoned',
  'a game paused for an hour with nobody at it is closed out'
);
select is(
  pg_temp.active('dddddddd-0000-0000-0000-000000000001'),
  null,
  'so the team has no open table and can start a new one'
);

select * from finish();
rollback;
