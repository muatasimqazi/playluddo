-- The Pink Glam board (designs/board-glam.svg): hot pink, aqua, sunshine and
-- lavender yards with lit vanity mirrors, compact nests, hearts and sparkles.
-- It comes with perfume-bottle pieces (lib/presentation/pieceStyles.ts).
--
-- Free to everyone for now, like every other board. To make it earned by
-- playing later, give it an unlock rule, e.g. the Regular achievement:
--   update public.cosmetics set unlock_achievement = 'games_10' where id = 'board_glam';
-- (plus lib/presentation/cosmeticGates.ts FREE_COSMETICS).

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak)
values ('board_glam', 'board', 'Pink Glam', 'Vanity mirrors, hearts and sparkles.', 50, null, null, null)
on conflict (id) do nothing;
