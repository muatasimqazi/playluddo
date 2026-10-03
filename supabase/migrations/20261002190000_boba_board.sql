-- The Boba board (designs/board-boba.svg): pastel yards with a kawaii cup of
-- bubble tea in each flavour (strawberry, matcha, mango, taro), pearl
-- clusters on the safe squares and a cup of milk tea seen from above. It
-- comes with bubble-tea cup pieces (lib/presentation/pieceStyles.ts).
--
-- Free to everyone for now, like every other board. To make it earned by
-- playing later, give it an unlock rule, e.g. the Regular achievement:
--   update public.cosmetics set unlock_achievement = 'games_10' where id = 'board_boba';
-- (plus lib/presentation/cosmeticGates.ts FREE_COSMETICS).

insert into public.cosmetics (id, type, name, description, sort, unlock_level, unlock_achievement, unlock_streak)
values ('board_boba', 'board', 'Boba', 'Bubble tea cups and tapioca pearls.', 53, null, null, null)
on conflict (id) do nothing;
