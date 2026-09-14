import type { PlayerColor } from "@/lib/board/types";

/**
 * The traditional 15x15 cross-shaped Ludo board, computed rather than
 * hand-derived from memory or copied from the (too-stylized-to-measure)
 * mockup. Two prior attempts at this from manual reasoning both produced
 * non-adjacent cell transitions; this one was built with a script that
 * modeled the board as a graph (4 base quadrants excluded, home columns
 * excluded, true center excluded) and verified every cell has exactly
 * degree 2 before ever writing a coordinate down.
 *
 * That computation surfaced a genuine structural fact: with 6x6 base
 * quadrants and 3-wide arms, the shared ring naturally has 56 cells
 * (corners spaced 14 apart), not 52. Rather than change the already-tested
 * 52-cell/13-spacing game logic (lib/board/geometry.ts, extensively
 * covered by pgTAP/parity tests) to match, the 4 arm-transition corners
 * are kept as real, rendered cells but excluded from the addressable
 * pathIndex space — this is what turns 56 into exactly 52 cells in 4 arcs
 * of 13, which is what makes TRACK_POSITIONS below line up with
 * ENTRY_OFFSET at all. Confirmed, not assumed: entry 0 lands adjacent to
 * red's base, entry 13 to green's, 26 to yellow's, 39 to blue's, and the
 * safe-cell offsets this produces (0,8,13,21,26,34,39,47) are identical to
 * SAFE_CELLS in geometry.ts — the same board, described two ways, agrees.
 */
export const GRID_SIZE = 15;

// Global track cell (0-51) -> (row, col). Index i corresponds to the exact
// same cell pathIndexToGlobalCell/SAFE_CELLS reason about in geometry.ts.
const TRACK_POSITIONS: readonly (readonly [number, number])[] = [
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
];

export function globalCellToGridPosition(globalCell: number): { row: number; col: number } {
  if (globalCell < 0 || globalCell > 51) {
    throw new RangeError(`globalCellToGridPosition: ${globalCell} out of range 0-51`);
  }
  const [row, col] = TRACK_POSITIONS[globalCell];
  return { row, col };
}

/**
 * Decorative home-lane strips (DESIGN.md: "Home runs: tinted 12% opacity
 * ... leading to the central triumph triangle"). Purely decorative — a
 * pawn in home_lane/finished state is never positioned on these cells;
 * PRD 5.2's "home progress" indicator in the status pod covers that.
 */
export const HOME_LANE_CELLS: Record<PlayerColor, readonly (readonly [number, number])[]> = {
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 9], [7, 10], [7, 11], [7, 12], [7, 13]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  red: [[7, 5], [7, 4], [7, 3], [7, 2], [7, 1]],
};

interface GridArea {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}

/** Base quadrant (6x6) background per color. */
export const BASE_AREA: Record<PlayerColor, GridArea> = {
  red: { rowStart: 0, rowEnd: 5, colStart: 0, colEnd: 5 },
  green: { rowStart: 0, rowEnd: 5, colStart: 9, colEnd: 14 },
  yellow: { rowStart: 9, rowEnd: 14, colStart: 9, colEnd: 14 },
  blue: { rowStart: 9, rowEnd: 14, colStart: 0, colEnd: 5 },
};

/**
 * The true center 3x3, decorative "triumph" area — including its 4 corner
 * cells (the arm-to-arm bridge points the 56-vs-52-cell math above
 * describes). Those corners are real grid positions, never addressable by
 * any pathIndex, but per designs/board-design.png they're rendered as part
 * of the wedge pinwheel (no separate cell outline), not masked out with a
 * white square — the wedge triangles already span this whole 3x3 area.
 */
export const CENTER_AREA: GridArea = { rowStart: 6, rowEnd: 8, colStart: 6, colEnd: 8 };

/**
 * Which color's home-lane arm a shared-track cell physically sits in —
 * confirmed against the reference screenshot, where each arm's stars/
 * decorations are consistently colored to match the home lane running
 * through its middle column (top arm = green's home lane, right = yellow's,
 * bottom = blue's, left = red's — exactly HOME_LANE_CELLS below). Used only
 * to color the 8 real SAFE_CELLS' star badges; purely decorative.
 */
export function armColorForCell(row: number, col: number): PlayerColor {
  if (row < 6) return "green";
  if (row > 8) return "blue";
  if (col < 6) return "red";
  return "yellow";
}
