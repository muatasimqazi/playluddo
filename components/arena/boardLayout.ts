import type { PlayerColor } from "@/lib/board/types";

/**
 * Visual layout for the 52-cell shared track, as a square ring on a 14x14
 * grid rather than the traditional cross/plus shape.
 *
 * This is a deliberate simplification, not an oversight — see the M4
 * commit notes. Reasoning: a 14x14 square ring has exactly 4*14-4 = 52
 * perimeter cells, and starting the traversal at a corner going clockwise
 * places the four corners at indices 0, 13, 26, 39 — which is EXACTLY
 * ENTRY_OFFSET from lib/board/geometry.ts. That's not a coincidence I
 * engineered after the fact; it's why this shape was chosen over
 * hand-copying a traditional board's pixel layout from memory, which risks
 * subtle, hard-to-verify coordinate bugs with no way to visually check them
 * in this environment. Home-lane/finished progress is shown in each
 * player's status pod (PRD 5.2 already requires a "home progress"
 * indicator there) rather than as literal on-board home-lane cells —
 * satisfying that requirement instead of duplicating it.
 *
 * Corners: 0 = red (top-left), 13 = green (top-right), 26 = yellow
 * (bottom-right), 39 = blue (bottom-left) — matches the color arrangement
 * confirmed against the design mockups.
 */
export const GRID_SIZE = 14;

export function globalCellToGridPosition(globalCell: number): { row: number; col: number } {
  if (globalCell < 0 || globalCell > 51) {
    throw new RangeError(`globalCellToGridPosition: ${globalCell} out of range 0-51`);
  }
  if (globalCell <= 13) return { row: 0, col: globalCell }; // top edge: TL -> TR
  if (globalCell <= 26) return { row: globalCell - 13, col: 13 }; // right edge: TR -> BR
  if (globalCell <= 39) return { row: 13, col: 13 - (globalCell - 26) }; // bottom edge: BR -> BL
  return { row: 13 - (globalCell - 39), col: 0 }; // left edge: BL -> TL
}

/** Grid rows/cols (inclusive) each color's nest occupies, in the ring's interior corner nearest their entry. */
export const NEST_AREA: Record<PlayerColor, { rowStart: number; rowEnd: number; colStart: number; colEnd: number }> = {
  red: { rowStart: 1, rowEnd: 5, colStart: 1, colEnd: 5 },
  green: { rowStart: 1, rowEnd: 5, colStart: 8, colEnd: 12 },
  yellow: { rowStart: 8, rowEnd: 12, colStart: 8, colEnd: 12 },
  blue: { rowStart: 8, rowEnd: 12, colStart: 1, colEnd: 5 },
};
