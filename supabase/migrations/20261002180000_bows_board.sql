-- The Pink Bows board (designs/board-bows.svg): ribbed satin yards with a
-- hair bow in each, rosette nests, a lace frame and a gift-wrapped centre.
-- It comes with hair-bow pieces (lib/presentation/pieceStyles.ts).
--
-- Free to everyone for now, like every other board. To make it earned by
-- playing later, give it an unlock rule, e.g. the Regular achievement:
--   update public.cosmetics set unlock_achievement = 'games_10' where id = 'board_bows';
-- (plus lib/presentation/cosmeticGates.ts FREE_COSMETICS).

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak)
values ('board_bows', 'board', 'Pink Bows', 'Satin bows, ribbons and lace.', 52, null, null, null)
on conflict (id) do nothing;
