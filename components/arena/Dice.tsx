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

interface DiceProps {
  value: number | null;
  playerColor: PlayerColor;
  /** Outer body size in px. DESIGN.md's "56-64pt" is the default; a smaller
   * size is used when the dice sits inline next to a player name card. */
  size?: number;
  /** When provided, the dice becomes the roll trigger itself (a real
   * <button>, tap/click to roll) instead of a plain display — per direct
   * instruction: the dice next to the acting player's name card IS the
   * roll control now, replacing a separate "Roll Dice" button. */
  onRoll?: () => void;
  disabled?: boolean;
}

export function Dice({ value, playerColor, size = 64, onRoll, disabled = false }: DiceProps) {
  const isSix = value === 6;
  const isInteractive = onRoll !== undefined;
  // Same proportions as the original fixed 64px body (40px pip grid, 7px
  // pips) so a smaller inline dice scales down cleanly instead of just
  // cropping.
  const gridSize = Math.round(size * 0.625);
  const pipSize = Math.max(4, Math.round(size * 0.109));

  const label = value === null ? (isInteractive ? "Tap to roll the dice" : "No roll yet") : `Dice showing ${value}`;

  const body = (
    <>
      {value === null ? (
        <span
          className="font-bold text-text-muted"
          style={{ fontSize: size * 0.34 }}
          aria-hidden
        >
          –
        </span>
      ) : (
        <div
          className="grid grid-cols-3 grid-rows-3 gap-0.5"
          style={{ width: gridSize, height: gridSize }}
          aria-hidden
        >
          {Array.from({ length: 9 }, (_, i) => {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const active = PIP_LAYOUT[value]?.some(([r, c]) => r === row && c === col);
            return (
              <span
                key={i}
                className={`m-auto rounded-full ${active ? "bg-foreground" : ""}`}
                style={{ width: pipSize, height: pipSize }}
              />
            );
          })}
        </div>
      )}
    </>
  );

  // A ring around the body signals "roll" affordance (interactive, not
  // disabled, not yet rolled this phase) or the six-roll pulse (either
  // state) — never both at once, so a single boxShadow value covers it.
  // Set via inline style (not a Tailwind shadow-* class) since the size is
  // already dynamic — a disabled `shadow-none` class couldn't win against
  // that inline style's specificity, so disabled state just omits the ring
  // instead of trying to override it.
  const ringShadow = isSix
    ? `0 0 0 3px var(--quadrant-${playerColor})`
    : isInteractive && !disabled
      ? `0 0 0 2px var(--quadrant-${playerColor})`
      : undefined;

  const sharedClassName = `relative flex shrink-0 items-center justify-center rounded-[14px] border border-hairline bg-white shadow-elevation-2 transition-transform ${
    isSix ? "animate-pulse" : ""
  }`;
  const sharedStyle = { width: size, height: size, ...(ringShadow ? { boxShadow: ringShadow } : {}) };

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={onRoll}
        disabled={disabled}
        className={`${sharedClassName} cursor-pointer active:scale-95 disabled:cursor-not-allowed disabled:opacity-60`}
        style={sharedStyle}
        aria-label={label}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={sharedClassName} style={sharedStyle} aria-label={label} role="img">
      {body}
    </div>
  );
}
