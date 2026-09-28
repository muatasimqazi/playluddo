import type { EnginePawn } from "./engine-types";
import {
  isSafeCell,
  PATH_INDEX,
  pathIndexToGlobalCell,
  tileIdToPathIndex,
  TRACK_LENGTH,
} from "./geometry";
import { applyMove, getLegalMoves } from "./rules";
import type { LegalMove } from "./types";

/**
 * Deterministic bot priority, per docs/PRD.md Section 6.8:
 *   1. Finish a pawn if possible.
 *   2. Capture an opponent if possible (prefer the move that captures the most pawns).
 *   3. Move a pawn out of the nest on a 6 if useful.
 *   4. Advance the pawn closest to finishing.
 *   5. Otherwise choose the first legal move by stable pawn order.
 *
 * Implemented as a single-pass argmax over a 5-key lexicographic priority
 * tuple, mirrored byte-for-byte in the plpgsql equivalent (used for both
 * timeout-driven auto-actions and full bot-takeover seats — PRD 5.2/6.8 —
 * so behavior never diverges by how a seat became bot-controlled).
 */
export function chooseBotMove(
  legalMoves: LegalMove[],
  pawns: EnginePawn[],
): LegalMove | null {
  let best: LegalMove | null = null;
  let bestFinish = false;
  let bestCaptureCount = -1;
  let bestNestExit = false;
  let bestResultPathIndex = -Infinity;
  let bestPawnIndex = Infinity;

  for (const move of legalMoves) {
    const pawn = pawns.find((p) => p.id === move.pawnId);
    if (!pawn) continue;

    const isFinish = move.finishesPawn;
    const captureCount = move.capturesPawnIds.length;
    const isNestExit = move.fromTileId?.startsWith("nest:") ?? false;
    const resultPathIndex = tileIdToPathIndex(pawn.color, move.toTileId) ?? -1;
    const pawnIndex = pawn.index;

    const better =
      best === null ||
      (isFinish && !bestFinish) ||
      (isFinish === bestFinish && captureCount > bestCaptureCount) ||
      (isFinish === bestFinish &&
        captureCount === bestCaptureCount &&
        isNestExit &&
        !bestNestExit) ||
      (isFinish === bestFinish &&
        captureCount === bestCaptureCount &&
        isNestExit === bestNestExit &&
        resultPathIndex > bestResultPathIndex) ||
      (isFinish === bestFinish &&
        captureCount === bestCaptureCount &&
        isNestExit === bestNestExit &&
        resultPathIndex === bestResultPathIndex &&
        pawnIndex < bestPawnIndex);

    if (better) {
      best = move;
      bestFinish = isFinish;
      bestCaptureCount = captureCount;
      bestNestExit = isNestExit;
      bestResultPathIndex = resultPathIndex;
      bestPawnIndex = pawnIndex;
    }
  }

  return best;
}

/**
 * Computer difficulty for offline practice (docs/COMPETITIVE_ROADMAP.md
 * F1.4). Online seats always use chooseBotMove above, mirrored in SQL
 * (decision 6), so this never needs a server copy.
 */
export type BotLevel = "easy" | "normal" | "hard";

export const BOT_LEVELS: readonly BotLevel[] = ["easy", "normal", "hard"];

export function chooseMoveForLevel(
  level: BotLevel,
  legalMoves: LegalMove[],
  pawns: EnginePawn[],
  random: () => number = Math.random,
): LegalMove | null {
  if (level === "easy") return chooseEasyMove(legalMoves, random);
  if (level === "hard") return chooseHardMove(legalMoves, pawns);
  return chooseBotMove(legalMoves, pawns);
}

/** Easy: any legal move, though it likes to bring pieces out. */
export function chooseEasyMove(
  legalMoves: LegalMove[],
  random: () => number = Math.random,
): LegalMove | null {
  if (legalMoves.length === 0) return null;
  const exits = legalMoves.filter((m) => m.fromTileId?.startsWith("nest:"));
  const pool = exits.length > 0 && random() < 0.6 ? exits : legalMoves;
  return pool[Math.floor(random() * pool.length)];
}

/**
 * The chance an opponent can land on this pawn with their next roll: each
 * opponent pawn 1-6 cells behind it (and still on the shared track past that
 * point) hits with probability 1/6. Safe cells and home lanes can't be hit.
 * This is the one-roll expectation Hard plays against.
 */
function risk(pawns: EnginePawn[], pawn: EnginePawn) {
  if (pawn.state !== "track" || pawn.pathIndex === null) return 0;
  const cell = pathIndexToGlobalCell(pawn.color, pawn.pathIndex);
  if (isSafeCell(cell)) return 0;
  let threats = 0;
  for (const other of pawns) {
    if (other.color === pawn.color || other.state !== "track" || other.pathIndex === null) continue;
    const from = pathIndexToGlobalCell(other.color, other.pathIndex);
    const distance = (cell - from + TRACK_LENGTH) % TRACK_LENGTH;
    if (distance >= 1 && distance <= 6 && other.pathIndex + distance <= PATH_INDEX.LAST_TRACK_CELL)
      threats++;
  }
  return 1 - (5 / 6) ** threats;
}

/** What a pawn is worth where it stands: getting out, getting far, getting safe. */
function worth(pawn: EnginePawn) {
  if (pawn.state === "nest" || pawn.pathIndex === null) return 0;
  if (pawn.state === "finished") return 140;
  if (pawn.state === "home_lane") return 70 + pawn.pathIndex;
  return 10 + pawn.pathIndex;
}

/**
 * The whole board from `color`'s side: its pawns' worth less what each
 * risks on the next roll, against its opponents' the same way.
 */
function evaluate(pawns: EnginePawn[], color: EnginePawn["color"]) {
  const opponents = new Set(pawns.filter((p) => p.color !== color).map((p) => p.color)).size || 1;
  let mine = 0;
  let theirs = 0;
  for (const pawn of pawns) {
    const value = worth(pawn) * (1 - risk(pawns, pawn));
    if (pawn.color === color) mine += value;
    else theirs += value;
  }
  return mine - theirs / opponents;
}

/**
 * How much worse `color`'s board gets, on average over the six faces, once
 * `opponent` makes its best reply (best by its own evaluation).
 */
function expectedReplyCost(pawns: EnginePawn[], color: EnginePawn["color"], opponent: EnginePawn["color"]) {
  const before = evaluate(pawns, color);
  let total = 0;
  for (let die = 1; die <= 6; die++) {
    let reply = pawns;
    let replyScore = -Infinity;
    for (const move of getLegalMoves(pawns, opponent, die)) {
      const after = applyMove(pawns, move);
      const score = evaluate(after, opponent);
      if (score > replyScore) {
        reply = after;
        replyScore = score;
      }
    }
    total += evaluate(reply, color);
  }
  return total / 6 - before;
}

/**
 * Hard: looks one roll ahead. For each move it scores the board that
 * results, then subtracts what every opponent can do with their next roll,
 * averaged over the six faces. A move that earns another roll (a capture or
 * a pawn home) skips the opponents' turn, since it moves again first.
 *
 * Measured by tests/presentation/bot-strength.test.ts: about 63% of
 * head-to-head games against Normal, and about 31% of 4-player games
 * against three Normals (25% would be chance).
 */
export function chooseHardMove(legalMoves: LegalMove[], pawns: EnginePawn[]): LegalMove | null {
  let best: LegalMove | null = null;
  let bestScore = -Infinity;
  for (const move of legalMoves) {
    const pawn = pawns.find((p) => p.id === move.pawnId);
    if (!pawn) continue;
    const after = applyMove(pawns, move);
    const movesAgain = move.capturesPawnIds.length > 0 || move.finishesPawn;
    let score = evaluate(after, pawn.color);
    if (!movesAgain) {
      const opponents = new Set(
        after.filter((p) => p.color !== pawn.color && p.state !== "finished").map((p) => p.color),
      );
      for (const opponent of opponents) score += expectedReplyCost(after, pawn.color, opponent);
    }
    if (movesAgain) score += 15;
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  return best;
}
