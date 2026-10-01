-- pgTAP tests for supabase/migrations/20260930190000_purge_inactive_under13_accounts.sql:
-- which signed-in accounts the 30-day rule picks, who may ask, and that the
-- guest purge still takes only guests.
-- Run with `supabase test db` (requires `supabase start`).

begin;
select plan(9);

insert into auth.users (id, email, is_anonymous, last_sign_in_at, updated_at) values
  -- Signed in, under 13, idle for 40 days: due.
  ('aaaaaaaa-1300-0000-0000-000000000001', 'idle-child@age.test', false, now() - interval '40 days', now() - interval '40 days'),
  -- Signed in, under 13, signed in yesterday: not yet.
  ('aaaaaaaa-1300-0000-0000-000000000002', 'active-child@age.test', false, now() - interval '1 day', now() - interval '40 days'),
  -- Signed in, an adult, idle for a year: never.
  ('aaaaaaaa-1300-0000-0000-000000000003', 'idle-adult@age.test', false, now() - interval '365 days', now() - interval '365 days'),
  -- A guest, under 13, idle: the SQL guest purge's, not this one's.
  ('aaaaaaaa-1300-0000-0000-000000000004', null, true, now() - interval '40 days', now() - interval '40 days');

insert into private.age_declarations (user_id, eligible_from, declared_at) values
  ('aaaaaaaa-1300-0000-0000-000000000001', current_date + 365, now() - interval '40 days'),
  ('aaaaaaaa-1300-0000-0000-000000000002', current_date + 365, now() - interval '40 days'),
  ('aaaaaaaa-1300-0000-0000-000000000004', current_date + 365, now() - interval '40 days');
insert into private.age_declarations (user_id, birth_year, birth_month, declared_at) values
  ('aaaaaaaa-1300-0000-0000-000000000003', 1990, 1, now() - interval '365 days');

select is(
  array(select * from public.under13_purge_candidates()),
  array['aaaaaaaa-1300-0000-0000-000000000001'::uuid],
  'only the idle signed-in under-13 account is due'
);

-- A session counts as activity.
insert into auth.sessions (id, user_id, created_at, updated_at)
values (gen_random_uuid(), 'aaaaaaaa-1300-0000-0000-000000000001', now() - interval '2 days', now() - interval '2 days');
select is(
  (select count(*)::int from public.under13_purge_candidates()),
  0,
  'a recent session keeps the account'
);
delete from auth.sessions where user_id = 'aaaaaaaa-1300-0000-0000-000000000001';

select is(
  (select count(*)::int from public.under13_purge_candidates(0)),
  1,
  'a batch is at least one'
);

-- -------------------------------------------------------------------------
-- Only the Edge Function's service role may ask
-- -------------------------------------------------------------------------

select ok(
  has_function_privilege('service_role', 'public.under13_purge_candidates(int)', 'execute'),
  'the purge function (service_role) can list candidates'
);
select ok(
  not has_function_privilege('authenticated', 'public.under13_purge_candidates(int)', 'execute')
  and not has_function_privilege('anon', 'public.under13_purge_candidates(int)', 'execute'),
  'players cannot'
);

-- -------------------------------------------------------------------------
-- The guest purge is unchanged: guests only
-- -------------------------------------------------------------------------

select is(private.purge_inactive_under13_guests(), 1, 'the guest purge deletes the idle guest');
select ok(
  exists (select 1 from auth.users where id = 'aaaaaaaa-1300-0000-0000-000000000001'),
  'and leaves the signed-in account to the Edge Function (its photos need Storage)'
);

-- -------------------------------------------------------------------------
-- The daily wake-up
-- -------------------------------------------------------------------------

select lives_ok(
  $$select private.kick_under13_purge()$$,
  'without the Vault secrets the wake-up does nothing, quietly'
);
select is(
  (select schedule from cron.job where jobname = 'purge-inactive-under13-accounts'),
  '47 3 * * *',
  'it runs daily'
);

select * from finish();
rollback;
