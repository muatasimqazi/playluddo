import type { PawnState, PlayerColor } from "./types";

/**
 * Canonical board geometry, per docs/IMPLEMENTATION_HANDOFF.md Section 3
 * (which resolves docs/PRD.md Section 4.1's structure into literal values,
 * confirmed against the design mockups' "8 Safe Star Havens").
 *
 * This file must be mirrored byte-for-byte into the plpgsql equivalent in
 * supabase/migrations — see IMPLEMENTATION_HANDOFF.md Section 2 on why two
 * copies exist and how tests/parity keeps them honest. This file holds only
 * static data; branching legal-move logic is NOT here (that's the rest of
 * lib/board, built in M1 alongside its SQL counterpart and the parity suite).
 */

export const COLOR_ORDER: PlayerColor[] = ["red", "green", "yellow", "blue"];

export const TRACK_LENGTH = 52;

/** Global shared-track index (0-51) where each color's pawns enter play. */
export const ENTRY_OFFSET: Record<PlayerColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

/**
 * Global shared-track indices that are capture-immune: for each color, the
 * star cells 3 and 8 steps after its entry (NOT the bare entry cell itself
 * — a common assumption this file got wrong until it was checked against
 * designs/board-design.png directly, star badge by star badge, cell by
 * cell: the reference marks 3/8/16/21/29/34/42/47, not 0/8/13/21/26/34/39/47).
 * 8 cells total.
 */
export const SAFE_CELLS: ReadonlySet<number> = new Set([
  3, 8, 16, 21, 29, 34, 42, 47,
]);

/** pathIndex boundaries, per PRD 4.1 / Pawn.pathIndex (types.ts). */
export const PATH_INDEX = {
  ENTRY: 0,
  LAST_TRACK_CELL: 50, // 51 track cells occupied total (0-50 inclusive)
  HOME_LANE_START: 51,
  FINISHED: 56,
} as const;

/**
 * Converts a pawn's own-color pathIndex (0-50) to a global shared-track cell.
 * Only valid while the pawn is still on the shared track — pathIndex 51-56
 * are in a private home lane with no shared-track equivalent; look those up
 * in a separate per-color home-lane coordinate table (owned by the renderer).
 */
export function pathIndexToGlobalCell(
  color: PlayerColor,
  pathIndex: number,
): number {
  if (pathIndex < PATH_INDEX.ENTRY || pathIndex > PATH_INDEX.LAST_TRACK_CELL) {
    throw new RangeError(
      `pathIndexToGlobalCell: pathIndex ${pathIndex} is not on the shared track (valid range 0-${PATH_INDEX.LAST_TRACK_CELL})`,
    );
  }
  return (ENTRY_OFFSET[color] + pathIndex) % TRACK_LENGTH;
}

export function isSafeCell(globalCell: number): boolean {
  return SAFE_CELLS.has(globalCell);
}

/**
 * Stable tile-ID scheme, shared verbatim with the plpgsql mirror so both
 * engines' LegalMove.fromTileId/toTileId values are byte-identical and
 * parity fixtures can compare them directly:
 *   - nest:<color>            e.g. "nest:red"
 *   - track:<globalCell 0-51> e.g. "track:23"
 *   - home:<color>:<0-5>      e.g. "home:red:5" (5 = the final home cell)
 */
export function pathIndexToTileId(
  color: PlayerColor,
  pathIndex: number | null,
): string {
  if (pathIndex === null) return `nest:${color}`;
  if (pathIndex >= PATH_INDEX.ENTRY && pathIndex <= PATH_INDEX.LAST_TRACK_CELL) {
    return `track:${pathIndexToGlobalCell(color, pathIndex)}`;
  }
  if (pathIndex > PATH_INDEX.LAST_TRACK_CELL && pathIndex <= PATH_INDEX.FINISHED) {
    return `home:${color}:${pathIndex - PATH_INDEX.HOME_LANE_START}`;
  }
  throw new RangeError(`pathIndexToTileId: pathIndex ${pathIndex} out of range`);
}

/** Inverse of pathIndexToTileId. Throws on a tileId that doesn't belong to `color`. */
export function tileIdToPathIndex(
  color: PlayerColor,
  tileId: string,
): number | null {
  if (tileId === `nest:${color}`) return null;

  if (tileId.startsWith("track:")) {
    const globalCell = Number(tileId.slice("track:".length));
    return (globalCell - ENTRY_OFFSET[color] + TRACK_LENGTH) % TRACK_LENGTH;
  }

  const homePrefix = `home:${color}:`;
  if (tileId.startsWith(homePrefix)) {
    const homeIndex = Number(tileId.slice(homePrefix.length));
    return PATH_INDEX.HOME_LANE_START + homeIndex;
  }

  throw new RangeError(`tileIdToPathIndex: tileId "${tileId}" is not valid for color ${color}`);
}

/** Derives a pawn's PawnState from its pathIndex — the single place this mapping lives. */
export function deriveStateFromPathIndex(pathIndex: number | null): PawnState {
  if (pathIndex === null) return "nest";
  if (pathIndex <= PATH_INDEX.LAST_TRACK_CELL) return "track";
  if (pathIndex < PATH_INDEX.FINISHED) return "home_lane";
  return "finished";
}
