import { BOARD_4, type BoardSpec } from "./boardSpec";
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
 *
 * As of F5.2 the literal numbers live in lib/board/boardSpec.ts, derived from
 * an arm count, so the same functions serve the 4-arm cross (2-4 players) and
 * the 6-arm hexagon (5-6 players). Every function takes an optional `spec`
 * that defaults to the 4-arm board, and the constants below re-export the
 * 4-arm values under their historical names so existing callers and fixtures
 * are unchanged.
 */

export const COLOR_ORDER: readonly PlayerColor[] = BOARD_4.colors;

export const TRACK_LENGTH = BOARD_4.trackLength;

/** Global shared-track index (0-51) where each 4-arm color's pawns enter play. */
export const ENTRY_OFFSET: Readonly<Record<PlayerColor, number>> = BOARD_4.entryOffset;

/**
 * Global shared-track indices that are capture-immune on the 4-arm board: for
 * each color, its own entry cell plus the star cell 8 steps after it. 8 cells
 * total. See boardSpec.ts for how this generalizes to the 6-arm board.
 *
 * These are pure index labels, not fixed physical cells — they follow
 * ENTRY_OFFSET. When the board's 52-cell ring was rotated (per direct
 * instruction, so each color's entry sits in its own arm rather than the
 * next color's — see components/arena/boardLayout.ts's TRACK_POSITIONS
 * comment) the *physical* safe cells stayed exactly where they were
 * pixel-verified against designs/board-design.png; only the numbers
 * labeling them changed, from {3,8,16,21,29,34,42,47} (entry+3/entry+8
 * under the old ring orientation) back to entry+0/entry+8 below — which is
 * also what docs/IMPLEMENTATION_HANDOFF.md Section 3 specified from the
 * start.
 */
export const SAFE_CELLS: ReadonlySet<number> = BOARD_4.safeCells;

/** pathIndex boundaries for the 4-arm board, per PRD 4.1 / Pawn.pathIndex (types.ts). */
export const PATH_INDEX = BOARD_4.pathIndex;

/**
 * Converts a pawn's own-color pathIndex to a global shared-track cell.
 * Only valid while the pawn is still on the shared track — home-lane indices
 * are in a private home lane with no shared-track equivalent; look those up
 * in a separate per-color home-lane coordinate table (owned by the renderer).
 */
export function pathIndexToGlobalCell(
  color: PlayerColor,
  pathIndex: number,
  spec: BoardSpec = BOARD_4,
): number {
  if (pathIndex < spec.pathIndex.ENTRY || pathIndex > spec.pathIndex.LAST_TRACK_CELL) {
    throw new RangeError(
      `pathIndexToGlobalCell: pathIndex ${pathIndex} is not on the shared track (valid range 0-${spec.pathIndex.LAST_TRACK_CELL})`,
    );
  }
  return (spec.entryOffset[color] + pathIndex) % spec.trackLength;
}

export function isSafeCell(globalCell: number, spec: BoardSpec = BOARD_4): boolean {
  return spec.safeCells.has(globalCell);
}

/**
 * Stable tile-ID scheme, shared verbatim with the plpgsql mirror so both
 * engines' LegalMove.fromTileId/toTileId values are byte-identical and
 * parity fixtures can compare them directly:
 *   - nest:<color>            e.g. "nest:red"
 *   - track:<globalCell>      e.g. "track:23"
 *   - home:<color>:<0-4>      e.g. "home:red:4" (4 = the final home cell)
 */
export function pathIndexToTileId(
  color: PlayerColor,
  pathIndex: number | null,
  spec: BoardSpec = BOARD_4,
): string {
  if (pathIndex === null) return `nest:${color}`;
  if (pathIndex >= spec.pathIndex.ENTRY && pathIndex <= spec.pathIndex.LAST_TRACK_CELL) {
    return `track:${pathIndexToGlobalCell(color, pathIndex, spec)}`;
  }
  if (pathIndex > spec.pathIndex.LAST_TRACK_CELL && pathIndex <= spec.pathIndex.FINISHED) {
    return `home:${color}:${pathIndex - spec.pathIndex.HOME_LANE_START}`;
  }
  throw new RangeError(`pathIndexToTileId: pathIndex ${pathIndex} out of range`);
}

/** Inverse of pathIndexToTileId. Throws on a tileId that doesn't belong to `color`. */
export function tileIdToPathIndex(
  color: PlayerColor,
  tileId: string,
  spec: BoardSpec = BOARD_4,
): number | null {
  if (tileId === `nest:${color}`) return null;

  if (tileId.startsWith("track:")) {
    const globalCell = Number(tileId.slice("track:".length));
    return (globalCell - spec.entryOffset[color] + spec.trackLength) % spec.trackLength;
  }

  const homePrefix = `home:${color}:`;
  if (tileId.startsWith(homePrefix)) {
    const homeIndex = Number(tileId.slice(homePrefix.length));
    return spec.pathIndex.HOME_LANE_START + homeIndex;
  }

  throw new RangeError(`tileIdToPathIndex: tileId "${tileId}" is not valid for color ${color}`);
}

/** Derives a pawn's PawnState from its pathIndex — the single place this mapping lives. */
export function deriveStateFromPathIndex(
  pathIndex: number | null,
  spec: BoardSpec = BOARD_4,
): PawnState {
  if (pathIndex === null) return "nest";
  if (pathIndex <= spec.pathIndex.LAST_TRACK_CELL) return "track";
  if (pathIndex < spec.pathIndex.FINISHED) return "home_lane";
  return "finished";
}
