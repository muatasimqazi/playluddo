-- pgTAP tests for Team Up (F2.5):
--   20260929010000_team_up_schema.sql     (players.side, ludo_team_up_won)
--   20260929010100_team_up_validation.sql (set_team_up RPC)
--   20260929010200_team_up_moves.sql      (validate_team_room trigger, legal moves)
--   20260929010300_team_up_results.sql    (perform_move team win + rotation)
--
-- Team Up is its own RPC rather than a house-rule toggle: the server admits
-- only the one ruleset the Team Up engine and fixtures cover. Partners sit
-- opposite (red+yellow, green+blue), a side wins only when all eight of its
-- pawns are home, and a seat whose own four are home rolls for its partner.
-- The legal-move maths itself is proven equal to the client engine in
-- tests/parity; this suite covers the DB-side RPC, trigger and completion.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(15);

create temporary table tu_state (key text primary key, value jsonb);
grant select, insert on tu_state to authenticated;
insert into auth.users (id, is_anonymous)
select ('e4444444-0000-0000-0000-00000000000' || n)::uuid, true from generate_series(1, 2) n;

create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'e4444444-0000-0000-0000-00000000000' || n, true);
$$;
create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from tu_state where key = 'room';
$$;
create function pg_temp.two() returns uuid language sql as $$
  select (value->>'roomId')::uuid from tu_state where key = 'two';
$$;
create function pg_temp.seat_id(p_room uuid, p_seat int) returns uuid language sql as $$
  select id from public.players where room_id = p_room and seat_index = p_seat;
$$;
create function pg_temp.last_yellow() returns uuid language sql as $$
  select id from public.pawns
  where player_id = pg_temp.seat_id(pg_temp.room(), 2) and pawn_index = 3;
$$;

select ok(not (private.ludo_default_rules()->>'teamUp')::boolean, 'Team Up is off by default');

-- A four-player Luddo room, seated red(0) + green(1) + yellow(2) + blue(3).
set local role authenticated;
select pg_temp.as_user(1);
insert into tu_state values ('room', public.create_room('Hosty', null, 4));
select pg_temp.as_user(2);
insert into tu_state select 'guest', public.join_room((select value->>'code' from tu_state where key = 'room'), 'Guest');
select pg_temp.as_user(1);
select public.fill_bot(pg_temp.room(), 2);
select public.fill_bot(pg_temp.room(), 3);

-- A two-player room, to prove Team Up needs a full four-player table.
insert into tu_state values ('two', public.create_room('Solo', null, 2));

-- Only the host may turn Team Up on.
select pg_temp.as_user(2);
select throws_ok(
  format('select public.set_team_up(%L, true)', pg_temp.room()),
  'P0001', 'NOT_HOST',
  'a guest cannot turn Team Up on'
);

select pg_temp.as_user(1);
select throws_ok(
  format('select public.set_team_up(%L, true)', pg_temp.two()),
  'P0001', 'TEAM_UP_REQUIRES_FOUR_PLAYER_LUDO',
  'Team Up needs a four-player Luddo table'
);

-- A rule the Team Up engine does not cover blocks turning it on.
select public.set_room_rules(pg_temp.room(), '{"blockades": true}'::jsonb);
select throws_ok(
  format('select public.set_team_up(%L, true)', pg_temp.room()),
  'P0001', 'TEAM_UP_INCOMPATIBLE_RULES',
  'blockades and Team Up cannot both be on'
);
select public.set_room_rules(pg_temp.room(), '{"blockades": false}'::jsonb);

-- Turned on cleanly, and reflected in the room's stored ruleset.
select lives_ok(
  format('select public.set_team_up(%L, true)', pg_temp.room()),
  'the host turns Team Up on'
);
select is(
  (select rules->>'teamUp' from public.rooms where id = pg_temp.room()), 'true',
  'the room records Team Up as on'
);

-- Opposite seats form the two sides: red+yellow versus green+blue.
select results_eq(
  format($$select seat_index, side from public.players where room_id = %L order by seat_index$$, pg_temp.room()),
  $$values (0, 0::smallint), (1, 1::smallint), (2, 0::smallint), (3, 1::smallint)$$,
  'partners sit opposite each other on the same side'
);

-- With Team Up on, a rule change into an uncovered combination is refused by
-- the room trigger, not just the RPC. The panel always sends the full ruleset
-- (teamUp included), so blockades arrive alongside teamUp and the trigger bites.
-- set_team_up stored the full resolved ruleset, so reading it back and
-- flipping blockades reproduces exactly what the lobby panel would send.
select throws_ok(
  format('select public.set_room_rules(%L, %L::jsonb)', pg_temp.room(),
    ((select rules from public.rooms where id = pg_temp.room())
      || '{"blockades": true}'::jsonb)::text),
  'P0001', 'TEAM_UP_INCOMPATIBLE_RULES',
  'the room guards its ruleset while Team Up is on'
);

select lives_ok(
  format('select public.start_match(%L)', pg_temp.room()),
  'a Team Up match starts with all sixteen pawns in place'
);

-- Team Up may not be toggled once the match is under way.
select throws_ok(
  format('select public.set_team_up(%L, false)', pg_temp.room()),
  'P0001', 'ALREADY_STARTED',
  'Team Up is fixed once the match begins'
);
reset role;

-- Drive to the brink of a side win: red's own four are home, and so are
-- three of yellow's. Red, its own pawns done, now rolls for its partner.
update public.pawns set state = 'finished', path_index = 56
  where player_id = pg_temp.seat_id(pg_temp.room(), 0);                     -- red, all four
update public.pawns set state = 'finished', path_index = 56
  where player_id = pg_temp.seat_id(pg_temp.room(), 2) and pawn_index < 3;  -- yellow, three
update public.pawns set state = 'track', path_index = 50
  where player_id = pg_temp.seat_id(pg_temp.room(), 2) and pawn_index = 3;  -- yellow, last

-- A finished seat stays in rotation and controls only the partner's pawns.
select is(
  (select (m->>'pawnId')::uuid
   from jsonb_array_elements(
     private.ludo_legal_moves(private.ludo_room_pawns_json(pg_temp.room()), 'red', 6,
       (select match_rules from public.rooms where id = pg_temp.room()))
   ) m),
  pg_temp.last_yellow(),
  'red, its own four home, is offered its partner yellow''s last pawn'
);

-- Play that last yellow pawn home; the red seat is the one acting.
update public.rooms
set turn_player_id = pg_temp.seat_id(pg_temp.room(), 0),
    turn_phase = 'awaiting_move',
    active_dice_value = 6
where id = pg_temp.room();
select private.ludo_perform_move(pg_temp.room(), pg_temp.seat_id(pg_temp.room(), 0), pg_temp.last_yellow());

select results_eq(
  format($$select status, match_end_reason from public.rooms where id = %L$$, pg_temp.room()),
  $$values ('summary'::text, 'completed'::text)$$,
  'both partners home ends the match'
);
select is(
  (select cardinality(winner_ids) from public.rooms where id = pg_temp.room()), 4,
  'every seat is placed'
);
-- The winning side (red + yellow) is placed ahead of the losing one.
select results_eq(
  format($$select p.side
           from public.rooms r, unnest(r.winner_ids) with ordinality w(id, ord)
           join public.players p on p.id = w.id
           where r.id = %L order by w.ord$$, pg_temp.room()),
  $$values (0::smallint), (0::smallint), (1::smallint), (1::smallint)$$,
  'the winning side comes first in the placements'
);
select is(
  (select (payload->>'winningSide')::int from public.match_events
   where room_id = pg_temp.room() and event_type = 'match_completed'
   order by sequence desc limit 1),
  0,
  'the completion records which side won'
);

select * from finish();
rollback;
