-- pgTAP tests for supabase/migrations/20260928180000_party_round.sql: the
-- between-game round is opened by the screen once the game has ended, both
-- players and audience can answer once within the minute, and the answer
-- stays hidden until the minute is up. now() is fixed inside this
-- transaction, so the minute passing is simulated by backdating opened_at.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(21);

create temporary table rd_state (key text primary key, value jsonb);
grant select, insert on rd_state to authenticated;

insert into auth.users (id, is_anonymous)
select ('c9999999-0000-0000-0000-00000000000' || n)::uuid, true from generate_series(1, 5) n;

create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'c9999999-0000-0000-0000-00000000000' || n, true);
$$;
create function pg_temp.room() returns uuid language sql as $$
  select (value->>'roomId')::uuid from rd_state where key = 'party';
$$;
create function pg_temp.match() returns uuid language sql as $$
  select current_match_id from public.rooms where id = pg_temp.room();
$$;
create function pg_temp.round() returns jsonb language sql as $$
  select public.get_party_extras(pg_temp.room())->'round';
$$;

set local role authenticated;
select pg_temp.as_user(1);
insert into rd_state values ('party', public.create_party_room('ludo'));
select pg_temp.as_user(2);
insert into rd_state select 'ana', public.join_room_by_id(pg_temp.room(), 'Ana');
select pg_temp.as_user(3);
insert into rd_state select 'ben', public.join_room_by_id(pg_temp.room(), 'Ben');
select pg_temp.as_user(2);
select public.start_match(pg_temp.room());

-- -------------------------------------------------------------------------
-- Opening the round
-- -------------------------------------------------------------------------

select pg_temp.as_user(1);
select throws_ok(
  format('select public.open_party_round(%L)', pg_temp.room()),
  'P0001', 'INVALID_PHASE',
  'there is no round until the game has ended'
);
select is(pg_temp.round(), 'null'::jsonb, 'and nothing to answer');

-- The game ends.
reset role;
update public.rooms set status = 'summary', turn_phase = 'complete', turn_player_id = null,
  turn_deadline_at = null, winner_ids = array[(select (value->>'playerId')::uuid from rd_state where key = 'ana')]
where id = pg_temp.room();
set local role authenticated;

select pg_temp.as_user(2);
select throws_ok(
  format('select public.open_party_round(%L)', pg_temp.room()),
  'P0001', 'ROOM_NOT_FOUND',
  'a player cannot open the round: the screen runs the podium'
);
select pg_temp.as_user(1);
select lives_ok(format('select public.open_party_round(%L)', pg_temp.room()), 'the screen opens the round');
select isnt(pg_temp.round()->>'question', null, 'everyone gets the question');
select is((pg_temp.round()->>'closed')::boolean, false, 'and a minute to answer');
select is(pg_temp.round()->'answer', 'null'::jsonb, 'the answer is not given away');

-- Opening twice keeps the same question.
select lives_ok(format('select public.open_party_round(%L)', pg_temp.room()), 'the screen opens it again');
reset role;
select is(
  (select count(*)::int from public.party_rounds where match_id = pg_temp.match()), 1,
  'opening it again changes nothing'
);
set local role authenticated;

-- -------------------------------------------------------------------------
-- Answering
-- -------------------------------------------------------------------------

select pg_temp.as_user(2);
select lives_ok(format('select public.guess_party_round(%L, 7)', pg_temp.room()), 'a player answers');
select is((pg_temp.round()->>'myGuess')::int, 7, 'and sees their own answer');
select lives_ok(format('select public.guess_party_round(%L, 9)', pg_temp.room()), 'and can change it');
reset role;
select is(
  (select count(*)::int from public.party_guesses where match_id = pg_temp.match()), 1,
  'without answering twice'
);
set local role authenticated;
select pg_temp.as_user(2);
select throws_ok(
  format('select public.guess_party_round(%L, 1000)', pg_temp.room()),
  'P0001', 'INVALID_GUESS',
  'an answer has to be a sensible number'
);

-- The audience plays too.
select pg_temp.as_user(4);
select lives_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), 'Priya'),
  'someone joins the audience'
);
select lives_ok(format('select public.guess_party_round(%L, 3)', pg_temp.room()), 'and answers as well');

select pg_temp.as_user(5);
select throws_ok(
  format('select public.guess_party_round(%L, 4)', pg_temp.room()),
  'P0001', 'ROOM_NOT_FOUND',
  'someone who is not at the table cannot answer'
);
select pg_temp.as_user(1);
select throws_ok(
  format('select public.guess_party_round(%L, 4)', pg_temp.room()),
  'P0001', 'ROOM_NOT_FOUND',
  'and neither can the screen'
);

-- Nobody sees anyone else's answer while the round is open.
select pg_temp.as_user(3);
select is(pg_temp.round()->'closest', 'null'::jsonb, 'nobody can follow the leader');

-- -------------------------------------------------------------------------
-- The minute is up
-- -------------------------------------------------------------------------

reset role;
update public.party_rounds set opened_at = now() - interval '61 seconds' where match_id = pg_temp.match();
-- Ana answered 9 and Priya 3; the true answer settles who was closest.
update public.party_rounds set answer = 4 where match_id = pg_temp.match();
set local role authenticated;
select pg_temp.as_user(3);
select results_eq(
  $$select (pg_temp.round()->>'closed')::boolean, (pg_temp.round()->>'answer')::int,
           pg_temp.round()->'closest'->0->>'name'$$,
  $$values (true, 4, 'Priya'::text)$$,
  'once the minute is up the answer is given and the closest named'
);
select pg_temp.as_user(2);
select throws_ok(
  format('select public.guess_party_round(%L, 4)', pg_temp.room()),
  'P0001', 'ROUND_CLOSED',
  'and no late answers'
);

select * from finish();
rollback;
