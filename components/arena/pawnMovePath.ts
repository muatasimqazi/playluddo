import { pathIndexToGlobalCell } from "@/lib/board/geometry";
import type { PlayerColor } from "@/lib/board/types";
import { globalCellToGridPosition } from "./boardLayout";

export interface GridPoint {
  row: number;
  col: number;
}

/**
 * The board cells a pawn passes through moving from `fromPathIndex` to
 * `toPathIndex` along its own shared-track progression (pathIndex 0-50 —
 * see lib/board/geometry.ts's PATH_INDEX). One waypoint per intermediate
 * cell, in order, INCLUDING the destination but EXCLUDING the origin (the
 * pawn is already drawn there when a hop starts — see Board.tsx).
 *
 * Track-only, deliberately: a plain `layoutId` FLIP (Board.tsx) already
 * looks correct for nest exits, home-lane advances, finishing, and
 * capture-bumps-to-nest — each is a single short hop with no curve to
 * follow. A multi-cell TRACK advance is the one case that needs this:
 * FLIP interpolates in a straight line between two screen positions,
 * which for non-adjacent cells cuts across the board instead of
 * following the track's actual curve.
 */
export function trackHopWaypoints(color: PlayerColor, fromPathIndex: number, toPathIndex: number): GridPoint[] {
  const waypoints: GridPoint[] = [];
  for (let pathIndex = fromPathIndex + 1; pathIndex <= toPathIndex; pathIndex++) {
    waypoints.push(globalCellToGridPosition(pathIndexToGlobalCell(color, pathIndex)));
  }
  return waypoints;
}
