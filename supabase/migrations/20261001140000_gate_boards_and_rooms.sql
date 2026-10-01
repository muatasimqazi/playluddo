-- Boards and rooms are earned like every other cosmetic (docs/COMPETITIVE_ROADMAP.md F3.5).
--
-- Until now the table's Board & room picker offered every board and room to
-- everyone; the client now offers only what the account owns (the same
-- private.player_has_cosmetic check equip_cosmetic uses). Two catalog fixes
-- make that line up with the game as it ships:
--
-- * Classic is the board every new player starts on, so it becomes a free
--   default alongside Signature (it was locked at level 3).
-- * The mahogany study joins the room themes, unlocked at level 15 — between
--   the Café (12) and the Rooftop and Lake cabin's longer goals.

update public.cosmetics
set unlock_level = null, unlock_achievement = null, unlock_streak = null
where id = 'board_classic';

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak)
values ('room_mahogany', 'room', 'Mahogany Study', 'A panelled study with a fire.', 125, 15, null, null)
on conflict (id) do nothing;

-- Players already past level 15 have earned it; evaluate_cosmetics would
-- only grant it on their next level-up or match.
insert into public.player_cosmetics (user_id, cosmetic_id)
select pp.user_id, 'room_mahogany'
from public.player_progression pp
where pp.level >= 15
on conflict (user_id, cosmetic_id) do nothing;
