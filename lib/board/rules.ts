import type { EnginePawn } from "./engine-types";
import {
  PATH_INDEX,
  deriveStateFromPathIndex,
  isSafeCell,
  pathIndexToGlobalCell,
  pathIndexToTileId,
  tileIdToPathIndex,
} from "./geometry";
import type { LegalMove, PawnState, PlayerColor, RoomRules } from "./types";

/**
 * Authoritative-equivalent Luddo rules, per docs/PRD.md Section 4. This is
 * the CLIENT-SIDE copy (display/highlighting only) — the plpgsql functions
 * in supabase/migrations are what the server actually trusts. Keep this
 * file's logic byte-for-byte equivalent to that migration; tests/parity
 * enforces it. See docs/IMPLEMENTATION_HANDOFF.md Section 2.
 */

/**
 * Legal moves for one color given a die roll. Mirrors PRD 4.2-4.3:
 * - nest pawns need a 6 to enter. When the optional blockade rule is on,
 *   two opposing pawns on an unsafe shared-track cell block passing and
 *   landing; safe cells and a player's own pawns never block movement.
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
  /** The room's rules and whether this player has captured yet (F2.2). */
  context?: { rules?: Partial<RoomRules> | null; hasCaptured?: boolean },
): LegalMove[] {
  const moves: LegalMove[] = [];
  const resolved = resolveRoomRules(context?.rules);
  // Master mode: this player has to capture before any piece goes home.
  const heldBack = resolved.captureToEnterHome && !context?.hasCaptured;

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
    // Held back, a piece stops on the last shared square instead of passing
    // it. Only one still on the shared track: a piece already in the home
    // column has passed that point and carries on.
    const target =
      heldBack &&
      current <= PATH_INDEX.LAST_TRACK_CELL &&
      current + dieValue > PATH_INDEX.LAST_TRACK_CELL
        ? PATH_INDEX.LAST_TRACK_CELL
        : current + dieValue;
    if (target > PATH_INDEX.FINISHED) continue; // overshoot — illegal, excluded from legalMoves
    if (target === current) continue; // held back with nowhere to go
    // Blockades: two pieces of one colour on an unsafe square stop everyone
    // else, both from passing it and from landing on it.
    if (resolved.blockades && blockedBetween(pawns, color, current, target)) continue;

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

/** True if another colour holds a blockade on any shared square this move crosses. */
function blockedBetween(
  pawns: EnginePawn[],
  movingColor: PlayerColor,
  from: number,
  to: number,
): boolean {
  for (let step = from + 1; step <= Math.min(to, PATH_INDEX.LAST_TRACK_CELL); step++) {
    const cell = pathIndexToGlobalCell(movingColor, step);
    if (isSafeCell(cell)) continue;
    const byColor = new Map<PlayerColor, number>();
    for (const p of pawns) {
      if (p.color === movingColor || p.state !== "track" || p.pathIndex === null) continue;
      if (pathIndexToGlobalCell(p.color, p.pathIndex) !== cell) continue;
      byColor.set(p.color, (byColor.get(p.color) ?? 0) + 1);
    }
    for (const count of byColor.values()) if (count >= 2) return true;
  }
  return false;
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

/** Mirrors the SQL private.ludo_default_rules(). */
export const DEFAULT_ROOM_RULES: RoomRules = {
  bonusRollOnFinish: true,
  startOnBoard: 0,
  pawnsToWin: 4,
  captureToEnterHome: false,
  snakesAnyRollToStart: false,
  snakesBounceBack: false,
  matchMinutes: 0,
  blockades: false,
  turnSeconds: 15,
};

/**
 * Defaults, overlaid with whichever known keys `rules` sets. Mirrors the SQL
 * private.ludo_resolve_rules(), so older snapshots without rules resolve to
 * the same thing on both sides.
 */
export function resolveRoomRules(rules?: Partial<RoomRules> | null): RoomRules {
  const resolved = { ...DEFAULT_ROOM_RULES };
  if (typeof rules?.bonusRollOnFinish === "boolean")
    resolved.bonusRollOnFinish = rules.bonusRollOnFinish;
  if (typeof rules?.startOnBoard === "number") resolved.startOnBoard = rules.startOnBoard;
  if (typeof rules?.pawnsToWin === "number") resolved.pawnsToWin = rules.pawnsToWin;
  if (typeof rules?.captureToEnterHome === "boolean")
    resolved.captureToEnterHome = rules.captureToEnterHome;
  if (typeof rules?.snakesAnyRollToStart === "boolean")
    resolved.snakesAnyRollToStart = rules.snakesAnyRollToStart;
  if (typeof rules?.snakesBounceBack === "boolean")
    resolved.snakesBounceBack = rules.snakesBounceBack;
  if (typeof rules?.matchMinutes === "number") resolved.matchMinutes = rules.matchMinutes;
  if (typeof rules?.blockades === "boolean") resolved.blockades = rules.blockades;
  if (typeof rules?.turnSeconds === "number") resolved.turnSeconds = rules.turnSeconds;
  return resolved;
}

/**
 * PRD 4.2 plus F1.5: a roll grants one bonus follow-up roll on a six, a
 * capture, or (when the room's rule is on) a pawn reaching home. Never
 * stacked: this returns a boolean, not a count, by construction. A player's
 * final pawn never reaches this — finishing the match is handled first.
 */
export function earnsBonusRoll(
  dieValue: number,
  move: LegalMove,
  rules: RoomRules,
): boolean {
  return (
    dieValue === 6 ||
    move.capturesPawnIds.length > 0 ||
    (rules.bonusRollOnFinish && move.finishesPawn)
  );
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

/**
 * A colour earns its placement once enough of its pawns are home — all four
 * in the classic game, fewer in Quick mode (F2.1).
 */
export function isMatchWon(
  pawns: EnginePawn[],
  color: PlayerColor,
  rules?: Partial<RoomRules> | null,
): boolean {
  const { pawnsToWin } = resolveRoomRules(rules);
  return pawns.filter((p) => p.color === color && p.state === "finished").length >= pawnsToWin;
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
