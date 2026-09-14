"use client";

import type { PlayerColor } from "@/lib/board/types";

// DESIGN.md "The Dice Component": 56-64pt white body, 14px micro-radius,
// hairline border, deep-black pips (not a numeral) — six-roll pulses the
// active player's quadrant color.
const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
};

export function Dice({ value, playerColor }: { value: number | null; playerColor: PlayerColor }) {
  const isSix = value === 6;

  return (
    <div
      className={`relative flex h-16 w-16 items-center justify-center rounded-[14px] border border-hairline bg-white shadow-elevation-2 ${
        isSix ? "animate-pulse" : ""
      }`}
      style={isSix ? { boxShadow: `0 0 0 3px var(--quadrant-${playerColor})` } : undefined}
      aria-label={value === null ? "No roll yet" : `Dice showing ${value}`}
      role="img"
    >
      {value === null ? (
        <span className="text-2xl font-bold text-text-muted" aria-hidden>
          –
        </span>
      ) : (
        <div className="grid h-10 w-10 grid-cols-3 grid-rows-3 gap-0.5" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const active = PIP_LAYOUT[value]?.some(([r, c]) => r === row && c === col);
            return (
              <span
                key={i}
                className={`m-auto h-[7px] w-[7px] rounded-full ${active ? "bg-foreground" : ""}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
