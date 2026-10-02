-- The Bazaar board (designs/board-bazaar.svg; docs/COMPETITIVE_ROADMAP.md F3.5).
--
-- Free to everyone for now, like every other board. It is meant to be
-- earned by playing once there are more players; locking it then is one
-- update, e.g. the Regular achievement (ten games):
--   update public.cosmetics set unlock_achievement = 'games_10' where id = 'board_bazaar';
-- (plus lib/presentation/cosmeticGates.ts FREE_COSMETICS). It comes with
-- its own lantern pieces (lib/presentation/pieceStyles.ts), the way the
-- Aladdin board brings its minarets.
--
-- The Aladdin board was catalogued as "Bazaar" while every picker calls it
-- Aladdin; it takes its own name back so the two don't share one.

update public.cosmetics
set name = 'Aladdin', description = 'An Arabian-nights table.'
where id = 'board_aladdin';

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak)
values ('board_bazaar', 'board', 'Bazaar', 'Brass lanterns on a kilim.', 45, null, null, null)
on conflict (id) do nothing;
