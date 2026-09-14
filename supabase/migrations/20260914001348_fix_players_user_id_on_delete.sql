-- players.user_id -> auth.users(id) had no ON DELETE behavior, defaulting
-- to NO ACTION: deleting a user while they still held any seat (lobby,
-- active match, or a finished one nobody cleaned up) would be blocked
-- outright rather than handled. Fixed to ON DELETE SET NULL — the row is
-- already nullable (a bot-only seat already has user_id null), and an
-- orphaned seat needs no special handling beyond that: it looks exactly
-- like "nobody is behind this seat" to the existing M3 inactivity/takeover
-- logic (missed decisions -> inactive -> bot, or 45s staleness -> bot), and
-- private.ludo_caller_player_id can never match a null user_id, so the
-- deleted user (correctly) can no longer reclaim it either.

alter table public.players
  drop constraint players_user_id_fkey,
  add constraint players_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;
