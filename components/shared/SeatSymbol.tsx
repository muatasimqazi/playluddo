import type { CSSProperties } from "react";
import type { PlayerColor } from "@/lib/board/types";
import { SEAT_SYMBOLS, symbolSvgPoints } from "@/lib/presentation/accessibility";

/**
 * A seat's symbol (F5.5) on a chip of its colour, so a seat in any label
 * can be told apart without seeing colour. Decorative: whatever it sits
 * beside already names the player.
 */
export function SeatSymbol({
  color,
  seatColor,
  className = "",
}: {
  color: PlayerColor;
  /** The chip's colour, from the palette in use (seatColors). */
  seatColor: string;
  className?: string;
}) {
  return (
    <span
      className={`seat-symbol${color === "yellow" ? " is-light" : ""} ${className}`}
      style={{ "--seat-color": seatColor } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="-1 -1 2 2" focusable="false">
        <polygon points={symbolSvgPoints(SEAT_SYMBOLS[color])} />
      </svg>
    </span>
  );
}
