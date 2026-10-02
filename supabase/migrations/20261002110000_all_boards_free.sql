-- Every board design is free (docs/COMPETITIVE_ROADMAP.md F3.5, changed
-- 2026-10-02).
--
-- 20261001140000_gate_boards_and_rooms.sql left Geometric at level 8 and
-- the Bazaar at the both_games achievement. Every player now gets all four
-- boards; new boards added later can still carry unlock rules, which the
-- table's picker, the entrance and the locker already honour. Rooms, dice,
-- pieces and reactions stay earned.
--
-- private.player_has_cosmetic treats a catalog row with no unlock rule as
-- owned by everyone, so clearing the rules is the whole change.
-- lib/presentation/cosmeticGates.ts FREE_COSMETICS mirrors it for when the
-- server can't be asked.

update public.cosmetics
set unlock_level = null, unlock_achievement = null, unlock_streak = null
where id in ('board_geometric', 'board_aladdin');
