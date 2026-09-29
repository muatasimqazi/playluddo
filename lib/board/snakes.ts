import { resolveRoomRules } from "./rules";
import type { LegalMove, Pawn, PlayerColor, RoomRules } from "./types";

// Endpoints printed on designs/snake-and-ladder/snakes-and-ladders-board.svg
// (each ladder's foot and snake's head carries a "↑ N" / "↓ N" label).
// Keep SQL (private.snakes_move) in sync.
export const LADDERS: Readonly<Record<number, number>> = {
  3: 23,
  4: 16,
  7: 27,
  9: 30,
  17: 37,
  28: 54,
  36: 65,
  50: 73,
  71: 91,
  77: 84,
};
export const SNAKES: Readonly<Record<number, number>> = {
  22: 2,
  26: 6,
  59: 40,
  64: 44,
  82: 62,
  87: 46,
  93: 72,
  95: 75,
  98: 38,
};

/**
 * One piece each; a six enters the board, exact 100, no captures or bonus
 * rolls. The room's rules can let any roll start a piece and bounce a piece
 * back off 100 instead (F2.6).
 */
export function snakeMove(
  pawns: Pawn[],
  color: PlayerColor,
  die: number,
  rules?: Partial<RoomRules> | null,
): LegalMove | null {
  const { snakesAnyRollToStart, snakesBounceBack } = resolveRoomRules(rules);
  if (!Number.isInteger(die) || die < 1 || die > 6) return null;
  const pawn = pawns.find((p) => p.color === color && p.state !== "finished");
  if (!pawn) return null;
  if (pawn.pathIndex === null && die !== 6 && !snakesAnyRollToStart) return null;
  const rolled = (pawn.pathIndex ?? 0) + die;
  if (rolled > 100 && !snakesBounceBack) return null;
  // Bounces back off the end.
  const landingSquare = rolled > 100 ? 200 - rolled : rolled;
  const destination =
    LADDERS[landingSquare] ?? SNAKES[landingSquare] ?? landingSquare;
  return {
    pawnId: pawn.id,
    fromTileId: pawn.pathIndex === null ? null : `snakes:${pawn.pathIndex}`,
    toTileId: `snakes:${destination}`,
    capturesPawnIds: [],
    finishesPawn: destination === 100,
    landingSquare,
  };
}

export function applySnakeMove(pawns: Pawn[], move: LegalMove): Pawn[] {
  const destination = Number(move.toTileId.split(":")[1]);
  if (!Number.isInteger(destination) || destination < 1 || destination > 100)
    throw new Error("Invalid Snakes & Ladders destination");
  return pawns.map((pawn) =>
    pawn.id === move.pawnId
      ? {
          ...pawn,
          pathIndex: destination,
          state: destination === 100 ? "finished" : "track",
        }
      : pawn,
  );
}
