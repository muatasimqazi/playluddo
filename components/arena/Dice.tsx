"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { PlayerColor } from "@/lib/board/types";

// DESIGN.md "The Dice Component": 56-64pt white body, 14px micro-radius,
// hairline border, deep-black pips (not a numeral) — six-roll pulses the
// active player's quadrant color.
export const PIP_LAYOUT: Record<number, [number, number][]> = {
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

// A gentle spring for "the dice just settled" — gives the pip grid a
// slight bounce-in instead of snapping, without needing a keyframe array.
const SETTLE_TRANSITION = { type: "spring", stiffness: 420, damping: 16 } as const;

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

  // Purely decorative "in flight" flourish — starts the instant the roll
  // is tapped, stops once the RPC call actually resolves (tracked via
  // `disabled`, which the caller ties to its own pending state — success
  // or failure, the shake should stop either way). This never guesses the
  // outcome: the pip value shown always comes from `value`, which only
  // ever changes once the server's real answer lands (PRD 6.2 — no
  // client-side prediction of the dice value).
  const [isRolling, setIsRolling] = useState(false);
  const wasDisabledRef = useRef(disabled);
  useEffect(() => {
    if (wasDisabledRef.current && !disabled) setIsRolling(false);
    wasDisabledRef.current = disabled;
  }, [disabled]);

  function handleRollClick() {
    setIsRolling(true);
    onRoll?.();
  }

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
        <motion.div
          key={value}
          className="grid grid-cols-3 grid-rows-3 gap-0.5"
          style={{ width: gridSize, height: gridSize }}
          initial={{ scale: 0.55, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={SETTLE_TRANSITION}
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
        </motion.div>
      )}
    </>
  );

  // Priority: mid-roll shake beats the six-glow beats the plain "you can
  // tap this" ring — in practice only one is ever true at a time, since
  // isRolling always turns off before a value (and thus isSix) can land.
  const idleShadow = isInteractive && !disabled ? `0 0 0 2px var(--quadrant-${playerColor})` : "0 0 0 0px transparent";
  const sixShadow = `0 0 0 3px var(--quadrant-${playerColor})`;

  const animateTarget = isRolling
    ? { rotate: [0, -10, 10, -8, 8, 0], scale: [1, 1.06, 0.96, 1.05, 0.97, 1], boxShadow: idleShadow }
    : isSix
      ? { rotate: 0, scale: [1, 1.05, 1], boxShadow: [sixShadow, "0 0 0 6px transparent", sixShadow] }
      : { rotate: 0, scale: 1, boxShadow: idleShadow };

  const transition = isRolling
    ? { duration: 0.5, ease: "easeInOut" as const }
    : isSix
      ? { duration: 1.3, repeat: Infinity, ease: "easeInOut" as const }
      : SETTLE_TRANSITION;

  const sharedClassName =
    "relative flex shrink-0 items-center justify-center rounded-[14px] border border-hairline bg-white shadow-elevation-2";

  if (isInteractive) {
    return (
      <motion.button
        type="button"
        onClick={handleRollClick}
        disabled={disabled}
        className={`${sharedClassName} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
        style={{ width: size, height: size }}
        animate={animateTarget}
        transition={transition}
        whileTap={disabled ? undefined : { scale: 0.92 }}
        aria-label={label}
      >
        {body}
      </motion.button>
    );
  }

  return (
    <motion.div
      className={sharedClassName}
      style={{ width: size, height: size }}
      animate={animateTarget}
      transition={transition}
      aria-label={label}
      role="img"
    >
      {body}
    </motion.div>
  );
}

// A bare pip grid with no body/border/interactivity — for showing a
// player's last roll permanently (StatusPod's "Rolled N" readout), where
// the full Dice component's own box would be redundant. Per direct
// instruction: the roll-in-progress dice box disappears the moment a
// turn ends (and, for a no-legal-move roll, can end in the very same
// broadcast that would have shown it at all — see MatchArena.tsx's
// lastRollByPlayerId derivation), so pips shown only there are too easy
// to miss. This gives every card its own permanent, glanceable pip
// pattern alongside the text, matching a physical die at a glance rather
// than requiring the number to be read.
export function DicePipFace({ value, size = 14 }: { value: number; size?: number }) {
  const pipSize = Math.max(2, Math.round(size * 0.15));
  return (
    <span
      className="grid shrink-0 grid-cols-3 grid-rows-3 gap-px rounded-[3px] border border-hairline bg-white p-0.5"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const active = PIP_LAYOUT[value]?.some(([r, c]) => r === row && c === col);
        return (
          <span key={i} className={`m-auto rounded-full ${active ? "bg-foreground" : ""}`} style={{ width: pipSize, height: pipSize }} />
        );
      })}
    </span>
  );
}
