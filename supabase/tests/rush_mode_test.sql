-- pgTAP tests for supabase/migrations/20260928220000_rush_mode.sql and
-- 20260928220100_rush_mode_clock.sql: a timed match starts a clock, the
-- clock stops while the match is paused, the turn in progress finishes,
-- and when time is up everyone is ranked where they stand.
-- now() is fixed inside this transaction, so time passing is simulated by
-- moving the clock.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(12);

create temporary table rm_state (key text primary key, value jsonb);
grant select, insert on rm_state to authenticated;
insert into auth.users (id, is_anonymous)
select ('d3333333-0000-0000-0000-00000000000' || n)::uuid, true from generate_series(1, 2) n;

create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'd3333333-0000-0000-0000-00000000000' || n, true);
$$;
create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from rm_state where key = 'room';
$$;
create function pg_temp.seat(k text) returns uuid language sql as $$
  select (value->>'playerId')::uuid from rm_state where key = k;
$$;

select ok(private.ludo_default_rules() @> '{"matchMinutes": 0}'::jsonb, 'matches have no clock by default');

set local role authenticated;
select pg_temp.as_user(1);
insert into rm_state values ('room', public.create_room('Hosty', null, 2));
select throws_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"matchMinutes": 7}'),
  'P0001', 'INVALID_RULES',
  'only 5 or 10 minutes, or none at all'
);
select lives_ok(
  format('select public.set_room_rules(%L, %L)', pg_temp.room(), '{"matchMinutes": 5}'),
  'a host sets a five-minute match'
);
select pg_temp.as_user(2);
insert into rm_state select 'guest', public.join_room((select value->>'code' from rm_state where key = 'room'), 'Guest');
select pg_temp.as_user(1);
select public.start_match(pg_temp.room());
reset role;

select ok(
  (select match_ends_at between now() + interval '4 minutes' and now() + interval '5 minutes'
   from public.rooms where id = pg_temp.room()),
  'the clock starts with the match'
);
select is(
  private.ludo_room_state_json(pg_temp.room())->>'matchEndsAt' is not null, true,
  'and the table is told when time runs out'
);

-- Pausing stops the clock.
set local role authenticated;
select pg_temp.as_user(1);
select public.toggle_match_pause(pg_temp.room(), true);
reset role;
update public.rooms set paused_at = now() - interval '60 seconds' where id = pg_temp.room();
set local role authenticated;
select pg_temp.as_user(1);
select public.toggle_match_pause(pg_temp.room(), false);
reset role;
select ok(
  (select match_ends_at > now() + interval '5 minutes' from public.rooms where id = pg_temp.room()),
  'a minute paused is a minute given back'
);

-- The turn in progress finishes: time up mid-turn does not end it there.
update public.rooms set match_ends_at = now() - interval '1 second' where id = pg_temp.room();
select is(
  (select status from public.rooms where id = pg_temp.room()), 'in_game',
  'the match is still running while the turn is being played'
);
-- Passing the turn on is where the clock is read.
select private.ludo_advance_to_next_player(pg_temp.room());
select results_eq(
  $$select status, turn_player_id is null, match_end_reason from public.rooms where id = pg_temp.room()$$,
  $$values ('summary'::text, true, 'completed'::text)$$,
  'and ends as the turn passes on'
);
select is(
  (select cardinality(winner_ids) from public.rooms where id = pg_temp.room()), 2,
  'everyone is placed, not just a winner'
);
select is(
  (select payload->>'reason' from public.match_events where room_id = pg_temp.room()
   and event_type = 'match_completed' order by sequence desc limit 1),
  'time',
  'and the match records that time ran out'
);

-- Ranking: whoever is further along comes first.
select is(
  (select winner_ids[1] from public.rooms where id = pg_temp.room()),
  (select p.id from public.players p where p.room_id = pg_temp.room()
   order by (select coalesce(sum(coalesce(pw.path_index, 0)), 0) from public.pawns pw where pw.player_id = p.id) desc,
            p.seat_index asc limit 1),
  'the player who got furthest is placed first'
);

-- A match with no clock is untouched.
set local role authenticated;
select pg_temp.as_user(1);
insert into rm_state values ('plain', public.create_room('NoClock', null, 2));
reset role;
select is(
  (select match_ends_at from public.rooms where id = (select (value->>'roomId')::uuid from rm_state where key = 'plain')),
  null,
  'a match with no clock has none'
);

select * from finish();
rollback;
