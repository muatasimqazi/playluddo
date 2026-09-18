import type { EnginePawn } from "./engine-types";
import {
  PATH_INDEX,
  deriveStateFromPathIndex,
  isSafeCell,
  pathIndexToGlobalCell,
  pathIndexToTileId,
  tileIdToPathIndex,
} from "./geometry";
import type { LegalMove, PawnState, PlayerColor } from "./types";

/**
 * Authoritative-equivalent Luddo rules, per docs/PRD.md Section 4. This is
 * the CLIENT-SIDE copy (display/highlighting only) — the plpgsql functions
 * in supabase/migrations are what the server actually trusts. Keep this
 * file's logic byte-for-byte equivalent to that migration; tests/parity
 * enforces it. See docs/IMPLEMENTATION_HANDOFF.md Section 2.
 */

/**
 * Legal moves for one color given a die roll. Mirrors PRD 4.2-4.3:
 * - nest pawns need a 6 to enter (no blockade check — own/opponent pawns
 *   never block movement in MVP).
 * - track/home_lane pawns need `current + dieValue` to not overshoot the
 *   final home cell (56); an overshooting pawn is simply excluded, not
 *   "moved and bounced".
 * - captures only occur when the destination is a shared-track cell
 *   (pathIndex <= 50) that isn't a safe cell; landing on a stack captures
 *   every opponent pawn there.
 */
export function getLegalMoves(
  pawns: EnginePawn[],
  color: PlayerColor,
  dieValue: number,
): LegalMove[] {
  const moves: LegalMove[] = [];

  for (const pawn of pawns) {
    if (pawn.color !== color) continue;

    if (pawn.state === "nest") {
      if (dieValue !== 6) continue;
      moves.push({
        pawnId: pawn.id,
        fromTileId: pathIndexToTileId(color, null),
        toTileId: pathIndexToTileId(color, PATH_INDEX.ENTRY),
        capturesPawnIds: capturesAt(pawns, color, PATH_INDEX.ENTRY),
        finishesPawn: false,
      });
      continue;
    }

    if (pawn.state === "finished") continue;

    const current = pawn.pathIndex;
    if (current === null) continue; // unreachable given state !== "nest", guards TS narrowing
    const target = current + dieValue;
    if (target > PATH_INDEX.FINISHED) continue; // overshoot — illegal, excluded from legalMoves

    const captures =
      target <= PATH_INDEX.LAST_TRACK_CELL ? capturesAt(pawns, color, target) : [];

    moves.push({
      pawnId: pawn.id,
      fromTileId: pathIndexToTileId(color, current),
      toTileId: pathIndexToTileId(color, target),
      capturesPawnIds: captures,
      finishesPawn: target === PATH_INDEX.FINISHED,
    });
  }

  return moves;
}

function capturesAt(
  pawns: EnginePawn[],
  movingColor: PlayerColor,
  targetPathIndex: number,
): string[] {
  const globalCell = pathIndexToGlobalCell(movingColor, targetPathIndex);
  if (isSafeCell(globalCell)) return [];

  return pawns
    .filter(
      (p) =>
        p.color !== movingColor &&
        p.state === "track" &&
        p.pathIndex !== null &&
        pathIndexToGlobalCell(p.color, p.pathIndex) === globalCell,
    )
    .map((p) => p.id);
}

/** Applies an already-legal move: relocates the moving pawn, sends captured pawns to nest. */
export function applyMove(pawns: EnginePawn[], move: LegalMove): EnginePawn[] {
  const movingPawn = pawns.find((p) => p.id === move.pawnId);
  if (!movingPawn) {
    throw new Error(`applyMove: unknown pawnId "${move.pawnId}"`);
  }

  const newPathIndex = tileIdToPathIndex(movingPawn.color, move.toTileId);
  const newState = deriveStateFromPathIndex(newPathIndex);
  const capturedIds = new Set(move.capturesPawnIds);

  return pawns.map((p) => {
    if (p.id === move.pawnId) {
      return { ...p, state: newState, pathIndex: newPathIndex };
    }
    if (capturedIds.has(p.id)) {
      return { ...p, state: "nest" as PawnState, pathIndex: null };
    }
    return p;
  });
}

/**
 * PRD 4.2: a roll grants one bonus follow-up roll on a six OR a capture —
 * NOT on finishing a pawn (confirmed), and never stacked (this returns a
 * boolean, not a count, by construction).
 */
export function earnsBonusRoll(dieValue: number, move: LegalMove): boolean {
  return dieValue === 6 || move.capturesPawnIds.length > 0;
}

export interface SixRollEvaluation {
  consecutiveSixesAfter: number;
  /** True iff this is the third consecutive six — PRD 4.2: cancels this roll's move, ends the turn. */
  cancelMove: boolean;
}

export function evaluateSixRoll(
  consecutiveSixesBefore: number,
  dieValue: number,
): SixRollEvaluation {
  if (dieValue !== 6) return { consecutiveSixesAfter: 0, cancelMove: false };
  const after = consecutiveSixesBefore + 1;
  return { consecutiveSixesAfter: after, cancelMove: after === 3 };
}

/** A color earns its placement once all 4 of its pawns are finished. */
export function isMatchWon(pawns: EnginePawn[], color: PlayerColor): boolean {
  return pawns.filter((p) => p.color === color && p.state === "finished").length === 4;
}

export interface PlayerProgress {
  id: string;
  pawnsFinished: number;
  /** Sum of forward-progress (pathIndex, treating nest as 0) across a player's 4 pawns. */
  totalProgress: number;
  /** Lower = earlier turn order. */
  turnOrder: number;
}

/**
 * PRD 4.4 ranking tiebreakers: pawns finished desc, then total progress desc,
 * then earlier turn order (lower turnOrder) wins the tie. Returns player ids
 * in rank order (index 0 = 1st place).
 */
export function rankPlayers(players: PlayerProgress[]): string[] {
  return [...players]
    .sort((a, b) => {
      if (b.pawnsFinished !== a.pawnsFinished) return b.pawnsFinished - a.pawnsFinished;
      if (b.totalProgress !== a.totalProgress) return b.totalProgress - a.totalProgress;
      return a.turnOrder - b.turnOrder;
    })
    .map((p) => p.id);
}
