-- pgTAP tests for supabase/migrations/20260928060000_online_age_check.sql:
-- the flag, declaring an age, the 13+ online and 18+ video boundaries,
-- which entry points are checked, and the under-13 guest purge.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(28);

create temporary table test_state (key text primary key, value jsonb);
grant select, insert on test_state to authenticated;

insert into auth.users (id, email, is_anonymous) values
  ('88888888-8888-8888-8888-888888888801', 'adult@age.test', false),
  ('88888888-8888-8888-8888-888888888802', 'child@age.test', false),
  ('88888888-8888-8888-8888-888888888803', 'turns13@age.test', false),
  ('88888888-8888-8888-8888-888888888804', 'just13@age.test', false),
  ('88888888-8888-8888-8888-888888888805', 'seventeen@age.test', false),
  ('88888888-8888-8888-8888-888888888806', null, true),
  ('88888888-8888-8888-8888-888888888807', 'undeclared@age.test', false),
  ('88888888-8888-8888-8888-888888888808', null, true),
  ('88888888-8888-8888-8888-888888888809', null, true);

-- Birth months relative to today, so the boundaries never go stale.
insert into test_state (key, value) select 'dates', jsonb_build_object(
  -- Turns 13 this month: eligible only from the 1st of next month.
  'turns13', jsonb_build_object('y', extract(year from current_date - interval '13 years')::int,
                                'm', extract(month from current_date - interval '13 years')::int),
  -- Turned 13 last month: eligible from the 1st of this month.
  'just13', jsonb_build_object('y', extract(year from current_date - interval '13 years 1 month')::int,
                               'm', extract(month from current_date - interval '13 years 1 month')::int),
  'seventeen', jsonb_build_object('y', extract(year from current_date - interval '17 years')::int,
                                  'm', extract(month from current_date - interval '17 years')::int),
  'child', jsonb_build_object('y', extract(year from current_date - interval '10 years')::int, 'm', 1)
);

-- -------------------------------------------------------------------------
-- Flag off (the default): nothing is asked or enforced
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888807';

select is(
  public.get_age_eligibility()->'required',
  'false'::jsonb,
  'the age check is off by default'
);

select lives_ok(
  $$select public.create_room('Undeclared', null, 2)$$,
  'with the flag off, an undeclared player can still create a room'
);

-- A room whose match is running before the flag is switched on.
insert into test_state (key, value) values ('running', (select public.create_room('Host', null, 2)));
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888806';
insert into test_state (key, value)
select 'runningGuest', public.join_room((select value->>'code' from test_state where key = 'running'), 'Guest');
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888807';
select public.start_match(((select value->>'roomId' from test_state where key = 'running'))::uuid);

reset role;
update private.feature_flags set enabled = true where name = 'online_age_check';
set local role authenticated;

-- -------------------------------------------------------------------------
-- Flag on: declaring
-- -------------------------------------------------------------------------

select is(
  public.get_age_eligibility()->'required',
  'true'::jsonb,
  'the flag switches the check on'
);

select throws_ok(
  $$select public.create_room('Undeclared', null, 2)$$,
  'P0001', 'AGE_REQUIRED',
  'an undeclared player is asked before creating a room'
);

set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888801';

select throws_ok($$select public.declare_age(1990, 13)$$, 'P0001', 'INVALID_BIRTH_DATE', 'a month outside 1-12 is rejected');
select throws_ok(
  format('select public.declare_age(%s, 1)', extract(year from current_date)::int + 1),
  'P0001', 'INVALID_BIRTH_DATE', 'a birth date in the future is rejected'
);

select is(
  public.declare_age(1990, 5) - 'required',
  '{"declared": true, "online": true, "video": true, "eligibleFrom": null}'::jsonb,
  'an adult with an account is allowed online and on video'
);

select throws_ok($$select public.declare_age(2000, 1)$$, 'P0001', 'AGE_ALREADY_DECLARED', 'the answer cannot be changed in the app');

select lives_ok($$select public.create_room('Adult', null, 2)$$, 'a declared adult can create a room');

reset role;
select is(
  (select array[birth_year, birth_month] from private.age_declarations
   where user_id = '88888888-8888-8888-8888-888888888801'),
  array[1990, 5],
  'a 13+ answer keeps the birth month and year'
);
set local role authenticated;

-- -------------------------------------------------------------------------
-- Under 13
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888802';
insert into test_state (key, value)
select 'childAnswer', public.declare_age(
  (select (value->'child'->>'y')::int from test_state where key = 'dates'),
  (select (value->'child'->>'m')::int from test_state where key = 'dates'));

select is(
  (select array[value->>'online', value->>'video'] from test_state where key = 'childAnswer'),
  array['false', 'false'],
  'an under-13 answer allows neither online play nor video'
);

reset role;
select is(
  (select (value->>'eligibleFrom')::date from test_state where key = 'childAnswer'),
  private.age_eligible_from((select (value->'child'->>'y')::int from test_state where key = 'dates'),
                            (select (value->'child'->>'m')::int from test_state where key = 'dates'), 13),
  'the device is told when the block lifts'
);
set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888802';

select throws_ok($$select public.create_room('Child', null, 2)$$, 'P0001', 'AGE_RESTRICTED', 'under 13: no creating rooms');
select throws_ok(
  format('select public.join_room(%L, %L)', (select value->>'code' from test_state where key = 'running'), 'Child'),
  'P0001', 'AGE_RESTRICTED', 'under 13: no joining by code'
);
select throws_ok($$select public.matchmake('ludo', 'Child', 4)$$, 'P0001', 'AGE_RESTRICTED', 'under 13: no quick match');

reset role;
select is(
  (select array[birth_year::text, birth_month::text, (eligible_from is not null)::text]
   from private.age_declarations where user_id = '88888888-8888-8888-8888-888888888802'),
  array[null, null, 'true'],
  'an under-13 answer stores no birth month or year'
);

-- A spent marker (its month has come) means the player is asked again.
update private.age_declarations set eligible_from = current_date - 1
where user_id = '88888888-8888-8888-8888-888888888802';
set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888802';
select is(
  public.get_age_eligibility()->'declared',
  'false'::jsonb,
  'once the eligible month arrives, the old answer no longer counts'
);
select lives_ok($$select public.declare_age(2010, 1)$$, 'and the player can answer again');

-- -------------------------------------------------------------------------
-- Month boundaries (decision 12)
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888803';
select is(
  public.declare_age((select (value->'turns13'->>'y')::int from test_state where key = 'dates'),
                     (select (value->'turns13'->>'m')::int from test_state where key = 'dates'))->'online',
  'false'::jsonb,
  'turning 13 this month: not yet (eligible from the 1st of next month)'
);

set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888804';
select is(
  public.declare_age((select (value->'just13'->>'y')::int from test_state where key = 'dates'),
                     (select (value->'just13'->>'m')::int from test_state where key = 'dates'))->'online',
  'true'::jsonb,
  'turned 13 last month: allowed'
);

set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888805';
select is(
  public.declare_age((select (value->'seventeen'->>'y')::int from test_state where key = 'dates'),
                     (select (value->'seventeen'->>'m')::int from test_state where key = 'dates')) - 'required' - 'eligibleFrom',
  '{"declared": true, "online": true, "video": false}'::jsonb,
  'a 17-year-old can play online but not use video'
);

set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888806';
select is(
  public.declare_age(1990, 5)->'video',
  'false'::jsonb,
  'a guest never gets video, even as an adult'
);

-- -------------------------------------------------------------------------
-- Matches already running keep going (decision 12)
-- -------------------------------------------------------------------------

set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888807';
select lives_ok(
  format('select public.claim_seat(%L)', (select value->>'roomId' from test_state where key = 'running')),
  'an undeclared player reconnecting to a running match is not interrupted'
);

reset role;
update public.rooms set status = 'lobby'
where id = ((select value->>'roomId' from test_state where key = 'running'))::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '88888888-8888-8888-8888-888888888807';
select throws_ok(
  format('select public.claim_seat(%L)', (select value->>'roomId' from test_state where key = 'running')),
  'P0001', 'AGE_REQUIRED',
  'coming back to a lobby for a new match is checked'
);

-- -------------------------------------------------------------------------
-- Privacy of the answers
-- -------------------------------------------------------------------------

select throws_ok($$select * from private.age_declarations$$, '42501', null, 'players cannot read age declarations');
select throws_ok($$select * from private.feature_flags$$, '42501', null, 'players cannot read or change feature flags');

-- -------------------------------------------------------------------------
-- Purging inactive under-13 guests (decision 13)
-- -------------------------------------------------------------------------

reset role;
-- 08: an under-13 guest idle for 40 days. 09: an under-13 guest active today.
insert into private.age_declarations (user_id, eligible_from, declared_at) values
  ('88888888-8888-8888-8888-888888888808', current_date + 365, now() - interval '40 days'),
  ('88888888-8888-8888-8888-888888888809', current_date + 365, now() - interval '40 days');
update auth.users set last_sign_in_at = now() - interval '40 days', updated_at = now() - interval '40 days',
                      created_at = now() - interval '40 days'
where id in ('88888888-8888-8888-8888-888888888808', '88888888-8888-8888-8888-888888888809');
update auth.users set last_sign_in_at = now() where id = '88888888-8888-8888-8888-888888888809';
-- 02 (a signed-in under-13 account) is also old, but is left for legal review.
update private.age_declarations
set birth_year = null, birth_month = null, eligible_from = current_date + 365, declared_at = now() - interval '40 days'
where user_id = '88888888-8888-8888-8888-888888888802';

select is(private.purge_inactive_under13_guests(), 1, 'exactly one account is purged');

select is(
  (select array_agg(id::text order by id) from auth.users
   where id in ('88888888-8888-8888-8888-888888888802', '88888888-8888-8888-8888-888888888808',
                '88888888-8888-8888-8888-888888888809')),
  array['88888888-8888-8888-8888-888888888802', '88888888-8888-8888-8888-888888888809'],
  'the idle under-13 guest is gone; the active guest and the signed-in account remain'
);

select * from finish();
rollback;
