-- Tester accounts own every cosmetic (docs/COMPETITIVE_ROADMAP.md F3.5).
--
-- Cosmetics are earned through levels, achievements and streaks, which makes
-- new dice, pieces and boards slow to try out on a real account. An account
-- listed here owns the whole catalog — including cosmetics added later — so
-- it can equip and see anything straight away. Nothing else about the
-- account changes: XP, levels, achievements and results are earned as usual.
--
-- private.player_has_cosmetic is the one ownership check (get_my_cosmetics'
-- "owned" and equip_cosmetic both go through it), so only it changes.
--
-- Testers are managed by hand with SQL, never from the client:
--   insert into private.cosmetic_testers (user_id, note) values ('<uuid>', 'who and why');
--   delete from private.cosmetic_testers where user_id = '<uuid>';

create table private.cosmetic_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '',
  added_at timestamptz not null default now()
);

alter table private.cosmetic_testers enable row level security;
revoke all on private.cosmetic_testers from public, anon, authenticated;

-- Redefines 20260929070000_cosmetics.sql's version: a tester owns everything.
create or replace function private.player_has_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cosmetics c
    where c.id = p_cosmetic_id
      and c.unlock_level is null and c.unlock_achievement is null and c.unlock_streak is null
  ) or exists (
    select 1 from public.player_cosmetics pc
    where pc.user_id = p_user_id and pc.cosmetic_id = p_cosmetic_id
  ) or (
    exists (select 1 from public.cosmetics c where c.id = p_cosmetic_id)
    and exists (select 1 from private.cosmetic_testers t where t.user_id = p_user_id)
  );
$$;

revoke execute on function private.player_has_cosmetic(uuid, text) from public;
