import { resolveRoomRules } from "./rules";
import type { LegalMove, Pawn, PlayerColor, RoomRules } from "./types";

export interface SnakesLayout {
  ladders: Readonly<Record<number, number>>;
  snakes: Readonly<Record<number, number>>;
}

// Two printed boards (F2.6). Each ladder's foot and snake's head carries a
// "↑ N" / "↓ N" label on its artwork. Keep the endpoints in sync with the
// SQL (private.snakes_move) CASE tables and the SVG each mirrors:
//   0 -> designs/snake-and-ladder/snakes-and-ladders-board.svg
//   1 -> designs/snake-and-ladder/snakes-and-ladders-board-2.svg
export const SNAKES_LAYOUTS: readonly SnakesLayout[] = [
  {
    ladders: { 3: 23, 4: 16, 7: 27, 9: 30, 17: 37, 28: 54, 36: 65, 50: 73, 71: 91, 77: 84 },
    snakes: { 22: 2, 26: 6, 59: 40, 64: 44, 82: 62, 87: 46, 93: 72, 95: 75, 98: 38 },
  },
  {
    ladders: { 2: 23, 8: 26, 20: 41, 32: 51, 40: 59, 63: 81, 74: 92, 85: 95 },
    snakes: { 17: 7, 30: 9, 43: 22, 54: 34, 66: 45, 76: 58, 89: 68, 97: 79 },
  },
];

/** The layout for a room's `snakesBoard` rule (0 default, 1 second board). */
export function snakesLayout(board?: number | null): SnakesLayout {
  return SNAKES_LAYOUTS[board === 1 ? 1 : 0];
}

// The default board's tables, kept as named exports for the many callers
// that only ever describe the standard game.
export const LADDERS = SNAKES_LAYOUTS[0].ladders;
export const SNAKES = SNAKES_LAYOUTS[0].snakes;

/**
 * One piece each; a six enters the board, exact 100, no captures or bonus
 * rolls. The room's rules can let any roll start a piece, bounce a piece
 * back off 100, and pick which of the two printed boards to play on (F2.6).
 */
export function snakeMove(
  pawns: Pawn[],
  color: PlayerColor,
  die: number,
  rules?: Partial<RoomRules> | null,
): LegalMove | null {
  const { snakesAnyRollToStart, snakesBounceBack, snakesBoard } = resolveRoomRules(rules);
  const { ladders, snakes } = snakesLayout(snakesBoard);
  if (!Number.isInteger(die) || die < 1 || die > 6) return null;
  const pawn = pawns.find((p) => p.color === color && p.state !== "finished");
  if (!pawn) return null;
  if (pawn.pathIndex === null && die !== 6 && !snakesAnyRollToStart) return null;
  const rolled = (pawn.pathIndex ?? 0) + die;
  if (rolled > 100 && !snakesBounceBack) return null;
  // Bounces back off the end.
  const landingSquare = rolled > 100 ? 200 - rolled : rolled;
  const destination =
    ladders[landingSquare] ?? snakes[landingSquare] ?? landingSquare;
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
