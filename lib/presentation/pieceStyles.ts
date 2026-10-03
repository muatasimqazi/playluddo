import type { GameType } from "../board/types";
import type { BoardStyle } from "./simulatorPrefs";

/**
 * Piece styles (docs/COMPETITIVE_ROADMAP.md F3.5). Each board design comes
 * with its own pieces (glass discs, classic pegs, Aladdin minarets, Bazaar
 * lanterns, the Rug's wool spindles, the Mosaic's glazed tiers, the
 * Sindbad's lighthouses, the Pink Glam's perfume bottles, the Cinderella's
 * princesses, the Pink Bows' hair-bow pegs); an equipped piece cosmetic replaces them for that
 * player's pieces only, and everyone at the table sees it. Every style keeps the seat colour as its
 * dominant colour, so pieces stay identifiable (F5.5 adds seat symbols).
 */
export type PieceStyle = "glass" | "classic" | "aladdin" | "bazaar" | "rug" | "mosaic" | "sindbad" | "glam" | "cinderella" | "bows" | "wood" | "marble";

const PIECE_COSMETIC_STYLE: Record<string, PieceStyle> = {
  piece_glass: "glass",
  piece_wood: "wood",
  piece_marble: "marble",
};

/** Every piece cosmetic the table can draw, in catalog order. */
export const PIECE_COSMETICS = Object.keys(PIECE_COSMETIC_STYLE);

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
  if (gameType === "ludo" && boardStyle === "bazaar") return "bazaar";
  if (gameType === "ludo" && boardStyle === "rug") return "rug";
  if (gameType === "ludo" && boardStyle === "mosaic") return "mosaic";
  if (gameType === "ludo" && boardStyle === "sindbad") return "sindbad";
  if (gameType === "ludo" && boardStyle === "glam") return "glam";
  if (gameType === "ludo" && boardStyle === "cinderella") return "cinderella";
  if (gameType === "ludo" && boardStyle === "bows") return "bows";
  return "glass";
}

/**
 * Standing figures (everything but the flat glass disc) share out a cell
 * side by side when several stack there; discs pile up instead.
 */
export function isFigure(style: PieceStyle) {
  return style !== "glass";
}
