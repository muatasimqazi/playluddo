-- private.ludo_is_safe_cell listed the bare entry cell as safe (0, 13, 26,
-- 39) plus a star 8 steps after it. Checked directly against
-- designs/board-design.png (star badge by star badge, cell by cell): the
-- actual safe cells are 3 and 8 steps after each color's entry, not the
-- entry cell itself. Mirrors lib/board/geometry.ts's SAFE_CELLS fix.
create or replace function private.ludo_is_safe_cell(p_global_cell int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_global_cell in (3, 8, 16, 21, 29, 34, 42, 47);
$$;
