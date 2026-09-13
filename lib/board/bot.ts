import type { EnginePawn } from "./engine-types";
import { tileIdToPathIndex } from "./geometry";
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
