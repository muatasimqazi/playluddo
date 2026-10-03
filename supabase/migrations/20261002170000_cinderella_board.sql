-- The Cinderella board (designs/board-cinderella.svg): a starry midnight sky
-- round a tiara, a castle, a pumpkin carriage and a glass slipper, with glass
-- slippers on the safe squares and a clock about to strike twelve. It comes
-- with its own princess pieces (lib/presentation/pieceStyles.ts).
--
-- Free to everyone for now, like every other board. To make it earned by
-- playing later, give it an unlock rule, e.g. the Regular achievement:
--   update public.cosmetics set unlock_achievement = 'games_10' where id = 'board_cinderella';
-- (plus lib/presentation/cosmeticGates.ts FREE_COSMETICS).

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak)
values ('board_cinderella', 'board', 'Cinderella', 'Glass slipper, pumpkin carriage and a midnight clock.', 51, null, null, null)
on conflict (id) do nothing;
