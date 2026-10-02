-- The game is spelled "Luddo" everywhere players see it (see app/about).
-- Achievement names and descriptions are data, so they're renamed here; the
-- ids ('ludo_win', ...) and Game Center ids are identifiers and stay as they are.

update public.achievements set name = 'Luddo Champion', description = 'Win a game of Luddo.'
  where id = 'ludo_win';
update public.achievements set description = 'Win at both Luddo and Snakes & Ladders.'
  where id = 'both_games';
update public.achievements set description = 'Win a game of Luddo without losing a pawn.'
  where id = 'flawless';
update public.achievements set description = 'Win a game of Luddo after losing three pawns.'
  where id = 'survivor';
