import type { PlayerColor } from "@/lib/board/types";

export const QUADRANT_CLASSES: Record<
  PlayerColor,
  { text: string; bg: string; border: string; tint: string }
> = {
  red: {
    text: "text-quadrant-red",
    bg: "bg-quadrant-red",
    border: "border-quadrant-red-border",
    tint: "bg-quadrant-red-tint",
  },
  green: {
    text: "text-quadrant-green",
    bg: "bg-quadrant-green",
    border: "border-quadrant-green-border",
    tint: "bg-quadrant-green-tint",
  },
  yellow: {
    text: "text-quadrant-yellow",
    bg: "bg-quadrant-yellow",
    border: "border-quadrant-yellow-border",
    tint: "bg-quadrant-yellow-tint",
  },
  blue: {
    text: "text-quadrant-blue",
    bg: "bg-quadrant-blue",
    border: "border-quadrant-blue-border",
    tint: "bg-quadrant-blue-tint",
  },
};

/** PRD 7.2: identity must never rely on color alone — every color pairs with a fixed initial/symbol. */
export const QUADRANT_INITIAL: Record<PlayerColor, string> = {
  red: "R",
  green: "G",
  yellow: "Y",
  blue: "B",
};
