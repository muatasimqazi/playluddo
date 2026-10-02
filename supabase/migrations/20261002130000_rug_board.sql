-- The Rug board (designs/board-rug.svg), a Persian/Balochi rug, with its own
-- wool-spindle pieces (lib/presentation/pieceStyles.ts;
-- docs/COMPETITIVE_ROADMAP.md F3.5).
--
-- Free to everyone for now, like every other board. To make it earned by
-- playing later, give it an unlock rule, e.g. the Regular achievement:
--   update public.cosmetics set unlock_achievement = 'games_10' where id = 'board_rug';
-- (plus lib/presentation/cosmeticGates.ts FREE_COSMETICS).

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak)
values ('board_rug', 'board', 'Rug', 'A hand-knotted Balochi rug.', 47, null, null, null)
on conflict (id) do nothing;
