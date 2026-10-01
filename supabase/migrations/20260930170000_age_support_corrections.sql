-- Support corrections to an age answer (docs/COMPETITIVE_ROADMAP.md F0.4;
-- decisions 5 and 13; Section 15, R3).
--
-- An age answer is final in the app (decision 5): someone who mistyped, or a
-- parent whose child answered on their phone, goes through support. This adds
-- the one way staff change it, so every change is deliberate and on record:
--
--   select private.support_correct_age(
--     '<user id>', 'Sam (support)', 'Mistyped 2013 for 1993, confirmed by email',
--     1993, 4, 'SUP-123');                     -- set birth year and month
--   select private.support_correct_age(
--     '<user id>', 'Sam (support)', 'Parent asked to reset the answer');
--                                              -- clear: asked again next time
--
-- Run it from the SQL editor (as postgres). It isn't callable by any app role,
-- and the audit rows go with the account when it's deleted, like the answer.
-- The procedure is written up in docs/SUPPORT.md.

alter table private.age_declarations drop constraint age_declarations_source_check;
alter table private.age_declarations
  add constraint age_declarations_source_check check (source in ('self_declared', 'support'));

create table private.age_corrections (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('set', 'cleared')),
  -- The answer before and after: birthYear, birthMonth, eligibleFrom, source,
  -- declaredAt. An under-13 answer never held a birth month or year, so
  -- neither does its record here.
  previous jsonb,
  corrected jsonb,
  reason text not null check (length(trim(reason)) >= 5),
  ticket text,
  corrected_by text not null check (length(trim(corrected_by)) > 0),
  corrected_at timestamptz not null default now()
);
create index age_corrections_user_idx on private.age_corrections (user_id, corrected_at desc);
revoke all on private.age_corrections from public, anon, authenticated;

create or replace function private.age_declaration_json(p_row private.age_declarations)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_row.user_id is null then null else jsonb_build_object(
    'birthYear', p_row.birth_year,
    'birthMonth', p_row.birth_month,
    'eligibleFrom', p_row.eligible_from,
    'source', p_row.source,
    'declaredAt', p_row.declared_at
  ) end;
$$;
revoke execute on function private.age_declaration_json(private.age_declarations) from public;

-- Set a player's birth year and month, or clear their answer (both null) so
-- they're asked again at their next online table. An under-13 answer keeps
-- only its eligible-from month, as declare_age does (decision 13). Returns
-- what the player can now do, never the birth data.
create or replace function private.support_correct_age(
  p_user_id uuid,
  p_corrected_by text,
  p_reason text,
  p_birth_year int default null,
  p_birth_month int default null,
  p_ticket text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous private.age_declarations;
  v_current private.age_declarations;
  v_anonymous boolean;
begin
  if p_user_id is null then raise exception 'USER_REQUIRED'; end if;
  select is_anonymous into v_anonymous from auth.users where id = p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if p_corrected_by is null or length(trim(p_corrected_by)) = 0 then
    raise exception 'CORRECTED_BY_REQUIRED';
  end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if (p_birth_year is null) <> (p_birth_month is null) then
    raise exception 'BIRTH_YEAR_AND_MONTH_TOGETHER';
  end if;
  if p_birth_year is not null and (
    p_birth_month not between 1 and 12
    or p_birth_year < 1900
    or make_date(p_birth_year, p_birth_month, 1) > date_trunc('month', current_date)::date
  ) then
    raise exception 'INVALID_BIRTH_DATE';
  end if;

  select * into v_previous from private.age_declarations where user_id = p_user_id for update;
  delete from private.age_declarations where user_id = p_user_id;

  if p_birth_year is not null then
    if current_date < private.age_eligible_from(p_birth_year, p_birth_month, 13) then
      insert into private.age_declarations (user_id, eligible_from, source)
      values (p_user_id, private.age_eligible_from(p_birth_year, p_birth_month, 13), 'support')
      returning * into v_current;
    else
      insert into private.age_declarations (user_id, birth_year, birth_month, source)
      values (p_user_id, p_birth_year, p_birth_month, 'support')
      returning * into v_current;
    end if;
  end if;

  insert into private.age_corrections (
    user_id, action, previous, corrected, reason, ticket, corrected_by
  ) values (
    p_user_id,
    case when p_birth_year is null then 'cleared' else 'set' end,
    private.age_declaration_json(v_previous),
    private.age_declaration_json(v_current),
    trim(p_reason),
    nullif(trim(p_ticket), ''),
    trim(p_corrected_by)
  );

  return jsonb_build_object(
    'declared', v_current.user_id is not null,
    'online', v_current.birth_year is not null,
    'video', v_current.birth_year is not null
      and not coalesce(v_anonymous, true)
      and current_date >= private.age_eligible_from(v_current.birth_year, v_current.birth_month, 18),
    'eligibleFrom', v_current.eligible_from
  );
end;
$$;
revoke execute on function private.support_correct_age(uuid, text, text, int, int, text)
  from public, anon, authenticated, service_role;
