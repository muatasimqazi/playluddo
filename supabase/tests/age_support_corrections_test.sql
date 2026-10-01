-- pgTAP tests for supabase/migrations/20260930170000_age_support_corrections.sql:
-- only staff can correct an age, every correction is validated and audited,
-- under-13 corrections keep no birth data, and the audit goes with the account.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(20);

insert into auth.users (id, email, is_anonymous) values
  ('99999999-9999-9999-9999-999999999901', 'mistyped@age.test', false),
  ('99999999-9999-9999-9999-999999999902', 'parent@age.test', false),
  ('99999999-9999-9999-9999-999999999903', null, true);

-- A grown-up who mistyped their year and came out under 13.
insert into private.age_declarations (user_id, eligible_from)
values ('99999999-9999-9999-9999-999999999901', current_date + 365);

-- -------------------------------------------------------------------------
-- No app role can call it
-- -------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999901';
select throws_ok(
  $$select private.support_correct_age('99999999-9999-9999-9999-999999999901', 'Me', 'Let me in please', 1990, 1)$$,
  '42501',
  null,
  'a player cannot correct their own age'
);
reset role;

select ok(
  not has_function_privilege('service_role', 'private.support_correct_age(uuid, text, text, int, int, text)', 'execute'),
  'service_role cannot call it either'
);
select ok(
  not has_table_privilege('authenticated', 'private.age_corrections', 'select'),
  'players cannot read the audit'
);

-- -------------------------------------------------------------------------
-- Validation
-- -------------------------------------------------------------------------

select throws_ok(
  $$select private.support_correct_age('99999999-9999-9999-9999-999999999999', 'Sam', 'Unknown account test', 1990, 1)$$,
  'P0001', 'USER_NOT_FOUND', 'an unknown account is rejected'
);
select throws_ok(
  $$select private.support_correct_age('99999999-9999-9999-9999-999999999901', '  ', 'No name given here', 1990, 1)$$,
  'P0001', 'CORRECTED_BY_REQUIRED', 'whoever makes the change must be named'
);
select throws_ok(
  $$select private.support_correct_age('99999999-9999-9999-9999-999999999901', 'Sam', 'no', 1990, 1)$$,
  'P0001', 'REASON_REQUIRED', 'a reason is required'
);
select throws_ok(
  $$select private.support_correct_age('99999999-9999-9999-9999-999999999901', 'Sam', 'Year without month', 1990, null)$$,
  'P0001', 'BIRTH_YEAR_AND_MONTH_TOGETHER', 'year and month come together'
);
select throws_ok(
  format($$select private.support_correct_age('99999999-9999-9999-9999-999999999901', 'Sam', 'Born next year?', %s, 1)$$,
         extract(year from current_date)::int + 1),
  'P0001', 'INVALID_BIRTH_DATE', 'a future birth month is rejected'
);
select is(
  (select count(*)::int from private.age_corrections),
  0,
  'a rejected correction leaves no audit row'
);

-- -------------------------------------------------------------------------
-- Setting the right age
-- -------------------------------------------------------------------------

select is(
  private.support_correct_age(
    '99999999-9999-9999-9999-999999999901', 'Sam (support)',
    'Mistyped the year, confirmed by email', 1990, 4, 'SUP-1'),
  jsonb_build_object('declared', true, 'online', true, 'video', true, 'eligibleFrom', null),
  'the corrected adult can play online and use video'
);
select is(
  (select source from private.age_declarations where user_id = '99999999-9999-9999-9999-999999999901'),
  'support',
  'the answer is marked as set by support'
);
select results_eq(
  $$select action, previous->>'birthYear', previous->>'eligibleFrom' is not null,
           corrected->>'birthYear', reason, ticket, corrected_by
      from private.age_corrections where user_id = '99999999-9999-9999-9999-999999999901'$$,
  $$values ('set', null::text, true, '1990', 'Mistyped the year, confirmed by email', 'SUP-1', 'Sam (support)')$$,
  'the audit records the old under-13 marker, the new answer, why, and who'
);

set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999901';
select is(
  public.get_age_eligibility()->'online',
  'true'::jsonb,
  'the player sees the corrected eligibility'
);
reset role;

-- -------------------------------------------------------------------------
-- Clearing: asked again next time
-- -------------------------------------------------------------------------

select is(
  private.support_correct_age(
    '99999999-9999-9999-9999-999999999901', 'Sam (support)', 'Player asked to answer again'),
  jsonb_build_object('declared', false, 'online', false, 'video', false, 'eligibleFrom', null),
  'clearing removes the answer'
);
select is(
  (select previous->>'birthYear' from private.age_corrections
    where user_id = '99999999-9999-9999-9999-999999999901' and action = 'cleared'),
  '1990',
  'the audit keeps what was cleared'
);

set local role authenticated;
set local request.jwt.claim.sub = '99999999-9999-9999-9999-999999999901';
select lives_ok(
  $$select public.declare_age(1991, 6)$$,
  'after clearing, the player answers again in the app'
);
reset role;

-- -------------------------------------------------------------------------
-- Under 13 through support keeps no birth data; guests get no video
-- -------------------------------------------------------------------------

select is(
  private.support_correct_age(
    '99999999-9999-9999-9999-999999999902', 'Sam (support)', 'Parent says their child answered',
    extract(year from current_date)::int - 9, 1)->'online',
  'false'::jsonb,
  'a child set by support cannot play online'
);
select ok(
  (select birth_year is null and birth_month is null and eligible_from is not null
     from private.age_declarations where user_id = '99999999-9999-9999-9999-999999999902')
  and (select corrected->>'birthYear' is null and corrected->>'eligibleFrom' is not null
     from private.age_corrections where user_id = '99999999-9999-9999-9999-999999999902'),
  'neither the answer nor its audit holds a child''s birth month or year'
);
select is(
  private.support_correct_age(
    '99999999-9999-9999-9999-999999999903', 'Sam (support)', 'Guest emailed with the right year', 1980, 2)->'video',
  'false'::jsonb,
  'a guest corrected to an adult still gets no video (V0: signed-in only)'
);

-- -------------------------------------------------------------------------
-- Deleting the account deletes its audit
-- -------------------------------------------------------------------------

delete from auth.users where id = '99999999-9999-9999-9999-999999999902';
select is(
  (select count(*)::int from private.age_corrections where user_id = '99999999-9999-9999-9999-999999999902'),
  0,
  'the audit goes with the account'
);

select * from finish();
rollback;
