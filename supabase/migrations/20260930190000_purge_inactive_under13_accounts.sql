-- The 30-day rule for signed-in under-13 accounts (docs/COMPETITIVE_ROADMAP.md
-- F0.4, decision 13, settled by the launch-market legal review on
-- 2026-09-30): like guests, a signed-in account whose answer is under 13 is
-- deleted, with everything tied to it, after 30 days without activity.
--
-- Guests are still deleted in SQL (purge_inactive_under13_guests). A signed-in
-- account can own an uploaded avatar photo, which only the Storage API can
-- remove, so those accounts go through the purge-under13-accounts Edge
-- Function: this job wakes it, it asks under13_purge_candidates() which
-- accounts are due, removes each one's photos, then deletes the account.
-- Without the URL and secret in Vault the job does nothing:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/purge-under13-accounts', 'under13_purge_url');
--   select vault.create_secret('<random secret>', 'under13_purge_secret');
--   -- and the same secret for the function: supabase secrets set UNDER13_PURGE_SECRET=...

-- Accounts with an under-13 answer and no activity for 30 days: the newest of
-- the answer, the last sign-in, any change to the account and any session.
create or replace function private.inactive_under13_users(p_anonymous boolean)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  join private.age_declarations d on d.user_id = u.id
  where d.eligible_from is not null
    and coalesce(u.is_anonymous, false) = p_anonymous
    and greatest(
      d.declared_at,
      u.last_sign_in_at,
      u.updated_at,
      (select max(greatest(s.created_at, s.updated_at, s.refreshed_at)) from auth.sessions s where s.user_id = u.id)
    ) < now() - interval '30 days';
$$;
revoke execute on function private.inactive_under13_users(boolean) from public;

-- Redefines 20260928060000_online_age_check.sql's version on the shared
-- query; what it deletes is unchanged.
create or replace function private.purge_inactive_under13_guests()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  delete from auth.users u
  where u.id in (select private.inactive_under13_users(true));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke execute on function private.purge_inactive_under13_guests() from public;

-- For the Edge Function only: the signed-in accounts that are due, oldest
-- answer first, a batch at a time.
create or replace function public.under13_purge_candidates(p_limit int default 100)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from private.inactive_under13_users(false) as c(id)
  join private.age_declarations d on d.user_id = c.id
  order by d.declared_at
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke execute on function public.under13_purge_candidates(int) from public, anon, authenticated;
grant execute on function public.under13_purge_candidates(int) to service_role;

create or replace function private.kick_under13_purge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'under13_purge_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'under13_purge_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  -- Nothing due: don't wake the function.
  if not exists (select 1 from private.inactive_under13_users(false)) then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function private.kick_under13_purge() from public;

-- Daily, half an hour after the guest purge.
select cron.schedule(
  'purge-inactive-under13-accounts',
  '47 3 * * *',
  $$select private.kick_under13_purge()$$
);
