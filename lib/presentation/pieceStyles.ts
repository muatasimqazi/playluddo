import type { GameType } from "../board/types";

/**
 * Piece styles (docs/COMPETITIVE_ROADMAP.md F3.5). Each board design comes
 * with its own pieces (glass discs, classic pegs, Aladdin minarets); an
 * equipped piece cosmetic replaces them for that player's pieces only, and
 * everyone at the table sees it. Every style keeps the seat colour as its
 * dominant colour, so pieces stay identifiable (F5.5 adds seat symbols).
 */
export type PieceStyle = "glass" | "classic" | "aladdin" | "wood" | "marble";

type BoardStyle = "signature" | "classic" | "geometric" | "aladdin";

const PIECE_COSMETIC_STYLE: Record<string, PieceStyle> = {
  piece_glass: "glass",
  piece_wood: "wood",
  piece_marble: "marble",
};

/**
 * A player's pieces: their equipped piece cosmetic if they've chosen one,
 * otherwise the pieces that come with the board (Luddo only — Snakes &
 * Ladders' own board uses the glass discs).
 */
export function pieceStyleFor(
  equipped: string | undefined,
  boardStyle: BoardStyle | undefined,
  gameType: GameType,
): PieceStyle {
  const chosen = equipped ? PIECE_COSMETIC_STYLE[equipped] : undefined;
  if (chosen) return chosen;
  if (gameType === "ludo" && boardStyle === "classic") return "classic";
  if (gameType === "ludo" && boardStyle === "aladdin") return "aladdin";
  return "glass";
}

/**
 * Standing figures (everything but the flat glass disc) share out a cell
 * side by side when several stack there; discs pile up instead.
 */
export function isFigure(style: PieceStyle) {
  return style !== "glass";
}
