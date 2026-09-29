-- pgTAP tests for supabase/migrations/20260928140000_party_audience.sql:
-- who can join a party room's audience and when, what audience phones can
-- do (reactions, a winner prediction, a moment-of-the-match vote), the
-- one-a-second limit, and who can read the results. now() is fixed inside
-- this transaction, so the limit is passed by backdating last_action_at.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(29);

create temporary table au_state (key text primary key, value jsonb);
grant select, insert on au_state to authenticated;

insert into auth.users (id, email, is_anonymous) values
  ('ffffffff-0000-0000-0000-000000000001', null, true),
  ('ffffffff-0000-0000-0000-000000000002', 'a@au.test', false),
  ('ffffffff-0000-0000-0000-000000000003', 'b@au.test', false),
  ('ffffffff-0000-0000-0000-000000000004', 'fan1@au.test', false),
  ('ffffffff-0000-0000-0000-000000000005', 'fan2@au.test', false),
  ('ffffffff-0000-0000-0000-000000000006', 'stranger@au.test', false),
  ('ffffffff-0000-0000-0000-000000000007', 'host@au.test', false);

create function pg_temp.room(k text default 'party') returns uuid language sql as $$
  select (value->>'roomId')::uuid from au_state where key = k;
$$;
create function pg_temp.seat(k text) returns uuid language sql as $$
  select (value->>'playerId')::uuid from au_state where key = k;
$$;
create function pg_temp.as_user(n int) returns void language sql as $$
  select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-00000000000' || n, true);
$$;
-- As the table owner: lift the one-a-second limit.
create function pg_temp.later() returns void language sql as $$
  update public.party_audience set last_action_at = now() - interval '2 seconds';
$$;

set local role authenticated;
select pg_temp.as_user(1);
insert into au_state values ('party', public.create_party_room('ludo'));
select pg_temp.as_user(2);
insert into au_state select 'a', public.join_room_by_id(pg_temp.room(), 'Ana');
select pg_temp.as_user(3);
insert into au_state select 'b', public.join_room_by_id(pg_temp.room(), 'Ben');

-- -------------------------------------------------------------------------
-- Joining
-- -------------------------------------------------------------------------

select pg_temp.as_user(4);
select throws_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), 'Fan One'),
  'P0001', 'SEATS_OPEN',
  'with seats open, a phone takes a seat instead'
);

select pg_temp.as_user(2);
select public.fill_bot(pg_temp.room(), 2);
select public.fill_bot(pg_temp.room(), 3);

select pg_temp.as_user(4);
select lives_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), 'Fan One'),
  'once the seats are full, a phone joins the audience'
);
select ok(private.party_is_audience(pg_temp.room()), 'the realtime policy recognises the audience');
select is(
  public.get_audience_state(pg_temp.room())->>'isParty', 'true',
  'the audience reads the table'
);

select pg_temp.as_user(1);
select throws_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), 'Screen'),
  'P0001', 'DISPLAY_CANNOT_SIT',
  'the screen cannot join the audience'
);
select pg_temp.as_user(2);
select throws_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), 'Ana'),
  'P0001', 'ALREADY_SEATED',
  'a player cannot also be audience'
);
select pg_temp.as_user(5);
select throws_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), '   '),
  'P0001', 'INVALID_NAME',
  'the audience needs a name'
);
select pg_temp.as_user(6);
select throws_ok(
  format('select public.get_audience_state(%L)', pg_temp.room()),
  'P0001', 'NOT_AUDIENCE',
  'a stranger cannot read the table'
);
select throws_ok(
  format('select public.get_party_extras(%L)', pg_temp.room()),
  'P0001', 'ROOM_NOT_FOUND',
  'or the audience extras'
);

-- Audience phones are 13+, like players.
reset role;
update private.feature_flags set enabled = true where name = 'online_age_check';
set local role authenticated;
select pg_temp.as_user(5);
select throws_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), 'Fan Two'),
  'P0001', 'AGE_REQUIRED',
  'the audience passes the same age check as players'
);
reset role;
update private.feature_flags set enabled = false where name = 'online_age_check';
set local role authenticated;

-- -------------------------------------------------------------------------
-- Before the start: predictions and reactions
-- -------------------------------------------------------------------------

select pg_temp.as_user(4);
select lives_ok(
  format('select public.predict_winner(%L, %L)', pg_temp.room(), pg_temp.seat('a')),
  'the audience picks a winner'
);
select throws_ok(
  format('select public.predict_winner(%L, %L)', pg_temp.room(), pg_temp.seat('b')),
  'P0001', 'Please wait a moment before sending another.',
  'one action a second'
);
reset role;
select pg_temp.later();
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok(
  format('select public.predict_winner(%L, %L)', pg_temp.room(), gen_random_uuid()),
  'P0001', 'PLAYER_NOT_FOUND',
  'only someone at this table can be picked'
);
select is(
  public.get_party_extras(pg_temp.room())->'predictions',
  jsonb_build_array(jsonb_build_object('playerId', pg_temp.seat('a'), 'count', 1)),
  'the lobby shows the picks'
);
reset role;
select pg_temp.later();
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok(
  format('select public.audience_react(%L, %L)', pg_temp.room(), 'free text'),
  'P0001', 'INVALID_MESSAGE',
  'reactions come from the fixed list'
);
select lives_ok(
  format('select public.audience_react(%L, %L)', pg_temp.room(), '🎉'),
  'the audience sends a reaction to the screen'
);

-- -------------------------------------------------------------------------
-- The game: picks are locked in
-- -------------------------------------------------------------------------

select pg_temp.as_user(2);
select public.start_match(pg_temp.room());
reset role;
select results_eq(
  $$select (select count(*)::int from public.party_predictions p join public.rooms r on r.current_match_id = p.match_id where r.id = pg_temp.room()),
           (select count(*)::int from public.party_audience where room_id = pg_temp.room() and predicted_player_id is not null)$$,
  $$values (1, 0)$$,
  'starting the game locks in the picks and clears the lobby''s'
);
select pg_temp.later();
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok(
  format('select public.predict_winner(%L, %L)', pg_temp.room(), pg_temp.seat('b')),
  'P0001', 'INVALID_PHASE',
  'no picks once the game has started'
);
select pg_temp.as_user(5);
select lives_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), 'Fan Two'),
  'phones can join the audience during the game'
);

-- -------------------------------------------------------------------------
-- The end: who called it, and the moment of the match
-- -------------------------------------------------------------------------

-- As the table owner: Ana captures one of Ben's pieces, then wins.
reset role;
select private.ludo_append_event(pg_temp.room(), 'legal_move_selected', pg_temp.seat('a'),
  jsonb_build_object('pawnId', gen_random_uuid(), 'toTileId', 'track:4', 'finishesPawn', false,
    'capturesPawnIds', jsonb_build_array((select id from public.pawns where player_id = pg_temp.seat('b') limit 1))));
select private.ludo_append_event(pg_temp.room(), 'legal_move_selected', pg_temp.seat('b'),
  jsonb_build_object('pawnId', gen_random_uuid(), 'toTileId', 'home:green:5', 'finishesPawn', true, 'capturesPawnIds', '[]'::jsonb));
select private.ludo_append_event(pg_temp.room(), 'player_finished', pg_temp.seat('a'), jsonb_build_object('place', 1));
update public.rooms set status = 'summary', turn_phase = 'complete', turn_player_id = null, turn_deadline_at = null,
  winner_ids = array[pg_temp.seat('a')]
where id = pg_temp.room();
select pg_temp.later();

set local role authenticated;
select pg_temp.as_user(4);
select is(
  public.get_party_extras(pg_temp.room())->'calledIt', '["Fan One"]'::jsonb,
  'the screen can show who called it'
);
select is(
  (select jsonb_agg(m->>'kind') from jsonb_array_elements(public.get_party_extras(pg_temp.room())->'moments') m),
  '["capture", "finished"]'::jsonb,
  'the moments are the capture and the win, not an ordinary piece getting home'
);
select is(
  public.get_party_extras(pg_temp.room())->'moments'->0->'capturedPlayerIds',
  jsonb_build_array(pg_temp.seat('b')),
  'a capture says whose piece it was'
);
select lives_ok(
  format('select public.vote_moment(%L, %s)', pg_temp.room(),
    (public.get_party_extras(pg_temp.room())->'moments'->0->>'sequence')),
  'the audience votes for a moment'
);
reset role;
select pg_temp.later();
set local role authenticated;
select pg_temp.as_user(4);
select throws_ok(
  format('select public.vote_moment(%L, %s)', pg_temp.room(), 1),
  'P0001', 'MOMENT_NOT_FOUND',
  'only for one of the match''s moments'
);
select is(
  (public.get_party_extras(pg_temp.room())->'votes'->0->>'count')::int, 1,
  'the votes are counted'
);
select pg_temp.as_user(2);
select lives_ok(
  format('select public.get_party_extras(%L)', pg_temp.room()),
  'players see the extras too'
);
select throws_ok(
  format('select public.vote_moment(%L, %s)', pg_temp.room(), 1),
  'P0001', 'NOT_AUDIENCE',
  'but only the audience votes'
);

-- -------------------------------------------------------------------------
-- Limits and other rooms
-- -------------------------------------------------------------------------

reset role;
insert into auth.users (id, is_anonymous) select gen_random_uuid(), true from generate_series(1, 28);
insert into public.party_audience (room_id, user_id, display_name)
select pg_temp.room(), id, 'Fan' from auth.users where email is null and id::text not like 'ffffffff%' and id not in (select user_id from public.party_audience)
limit 28;
set local role authenticated;
select pg_temp.as_user(6);
select throws_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room(), 'One too many'),
  'P0001', 'AUDIENCE_FULL',
  'the audience holds 30'
);

select pg_temp.as_user(7);
insert into au_state values ('plain', public.create_room('Hosty', null, 2));
select pg_temp.as_user(6);
select throws_ok(
  format('select public.join_party_audience(%L, %L)', pg_temp.room('plain'), 'Sam'),
  'P0001', 'NOT_PARTY_ROOM',
  'ordinary rooms have no audience'
);

select * from finish();
rollback;
