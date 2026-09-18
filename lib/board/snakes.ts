import type { LegalMove, Pawn, PlayerColor } from "./types";

// Endpoints on designs/snake-and-ladder.png. Keep the SQL engine in sync.
export const LADDERS: Readonly<Record<number, number>> = {
  4: 16,
  9: 30,
  21: 42,
  50: 68,
  63: 81,
  71: 91,
};
export const SNAKES: Readonly<Record<number, number>> = {
  14: 6,
  36: 24,
  54: 46,
  64: 59,
  94: 88,
  98: 78,
};

/** One piece each; any roll enters, exact 100, no captures or bonus rolls. */
export function snakeMove(
  pawns: Pawn[],
  color: PlayerColor,
  die: number,
): LegalMove | null {
  if (!Number.isInteger(die) || die < 1 || die > 6) return null;
  const pawn = pawns.find((p) => p.color === color && p.state !== "finished");
  if (!pawn) return null;
  const landingSquare = (pawn.pathIndex ?? 0) + die;
  if (landingSquare > 100) return null;
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
