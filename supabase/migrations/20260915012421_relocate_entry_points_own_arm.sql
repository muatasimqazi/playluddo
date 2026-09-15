-- The rendering-layer 52-cell ring (components/arena/boardLayout.ts's
-- TRACK_POSITIONS) was rotated by 47 cells, per direct instruction, so
-- each color's entry point sits inside its OWN arm (next to its own base,
-- alongside its own home lane) instead of at the far end of the NEXT
-- color's arm. ENTRY_OFFSET (private.ludo_entry_offset) is unchanged —
-- still 0/13/26/39 — only which physical board cell each of those numbers
-- points to moved.
--
-- Because SAFE_CELLS is defined as entry+3/entry+8, the physical safe
-- cells staying exactly where they were pixel-verified against
-- designs/board-design.png means the *numbers* labeling them had to
-- change: from (3, 8, 16, 21, 29, 34, 42, 47) back to entry+0/entry+8,
-- i.e. (0, 8, 13, 21, 26, 34, 39, 47) — which is also what
-- docs/IMPLEMENTATION_HANDOFF.md Section 3 specified from the start, and
-- what this same function returned before the prior
-- 20260914093055_fix_safe_cell_positions.sql migration. That migration
-- was not a mistake — it correctly matched the *old* ring orientation, and
-- this migration correctly matches the *new* one. Mirrors
-- lib/board/geometry.ts's SAFE_CELLS.
create or replace function private.ludo_is_safe_cell(p_global_cell int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_global_cell in (0, 8, 13, 21, 26, 34, 39, 47);
$$;
