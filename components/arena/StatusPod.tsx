"use client";

import { AnimatePresence, motion } from "framer-motion";
import { DicePipFace } from "./Dice";
import { QUADRANT_CLASSES, QUADRANT_INITIAL } from "@/components/shared/colors";
import { useCountdown } from "@/lib/hooks/useCountdown";
import type { GameRoomState, Player } from "@/lib/board/types";

// Shared spring for anything on the pod that "pops" rather than fades —
// the turn-highlight scale and the pill/badge entrances below all use the
// same feel so the card reads as one consistent object, not several
// independently-tuned pieces.
const POP_TRANSITION = { type: "spring", stiffness: 320, damping: 22 } as const;

interface StatusPodProps {
  player: Player;
  pawnCount: { finished: number; total: number };
  isCurrentTurn: boolean;
  turnDeadlineAt: string | null;
  isYou: boolean;
  /** Mirrors the pod for the board's right-side quadrants (green/yellow), matching the reference layout. */
  align?: "left" | "right";
  /**
   * This player's most recent roll, if any — per direct instruction, a
   * permanent record on the card itself (unlike the separate dice next to
   * the card, this never disappears: it just keeps updating). Answers
   * "what did they roll" even long after their turn has passed.
   */
  lastRoll?: number | null;
}

const DECISION_WINDOW_SECONDS = 15;
const AVATAR_SIZE = 36; // DESIGN.md "Player Status Pod": 36pt avatar circle
const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// DESIGN.md "Player Status Pod": passive opacity 0.72 with a plain hairline
// border; active turn state is full opacity, a 1.5pt player-color border,
// and a micro-scale of 1.03. The countdown ring depletes from the player's
// quadrant color into warning red as time runs low.
export function StatusPod({
  player,
  pawnCount,
  isCurrentTurn,
  turnDeadlineAt,
  isYou,
  align = "left",
  lastRoll,
}: StatusPodProps) {
  const classes = QUADRANT_CLASSES[player.color];
  const secondsLeft = useCountdown(isCurrentTurn ? turnDeadlineAt : null);
  const isLow = secondsLeft !== null && secondsLeft <= 5;
  const ringProgress = secondsLeft === null ? 1 : Math.max(0, Math.min(1, secondsLeft / DECISION_WINDOW_SECONDS));
  const isRight = align === "right";

  const avatar = (
    <div className="relative shrink-0" style={{ width: AVATAR_SIZE + 6, height: AVATAR_SIZE + 6 }}>
      <AnimatePresence>
        {isCurrentTurn && secondsLeft !== null && (
          <motion.svg
            key="ring"
            width={AVATAR_SIZE + 6}
            height={AVATAR_SIZE + 6}
            viewBox={`0 0 ${AVATAR_SIZE + 6} ${AVATAR_SIZE + 6}`}
            className="absolute inset-0 -rotate-90"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={POP_TRANSITION}
            aria-hidden
          >
            <circle
              cx={(AVATAR_SIZE + 6) / 2}
              cy={(AVATAR_SIZE + 6) / 2}
              r={RING_RADIUS}
              fill="none"
              stroke="#E5E7EB"
              strokeWidth={3}
            />
            <motion.circle
              cx={(AVATAR_SIZE + 6) / 2}
              cy={(AVATAR_SIZE + 6) / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={isLow ? "#EF4444" : `var(--quadrant-${player.color})`}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              // Explicit `initial` (matching animate's own current value at
              // mount) rather than none: strokeDashoffset is only ever set
              // via `animate` here, never a static attribute, and unlike a
              // CSS property, an SVG presentation attribute has no
              // meaningful "current" value Motion can read off the DOM to
              // animate from on first mount — hence "from undefined". Since
              // this element mounts fresh every turn (AnimatePresence
              // above), matching animate's value means the ring simply
              // appears at the correct progress instead of sweeping in from
              // nowhere; subsequent ticks (same mounted instance, target
              // value changing) still animate normally.
              initial={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - ringProgress) }}
              animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - ringProgress) }}
              // Matches useCountdown's own 250ms tick — a linear tween exactly
              // that long makes each tick's jump interpolate smoothly into the
              // next one, rather than a spring that would over/undershoot a
              // value that's about to move again a quarter-second later.
              transition={{ duration: 0.25, ease: "linear" }}
            />
          </motion.svg>
        )}
      </AnimatePresence>
      <div
        className={`absolute inset-0.75 flex items-center justify-center rounded-full text-label-md text-white ${classes.bg}`}
        aria-hidden
      >
        {QUADRANT_INITIAL[player.color]}
      </div>
    </div>
  );

  const info = (
    <div className={`min-w-0 flex-1 ${isRight ? "text-right" : ""}`}>
      <div className={`flex items-center gap-1.5 ${isRight ? "justify-end" : ""}`}>
        {isRight && isYou && (
          <span className="shrink-0 rounded-full bg-action px-1.5 py-0.5 text-label-sm text-white">YOU</span>
        )}
        <span className="truncate text-body-sm font-medium text-foreground">{player.displayName}</span>
        {!isRight && isYou && (
          <span className="shrink-0 rounded-full bg-action px-1.5 py-0.5 text-label-sm text-white">YOU</span>
        )}
      </div>
      <div className={`flex items-center gap-1 text-label-sm text-text-secondary ${isRight ? "justify-end" : ""}`}>
        <StatusBadge player={player} />
        <span aria-hidden>·</span>
        <span>
          {pawnCount.finished}/{pawnCount.total} home
        </span>
        {/* Always mounted (unlike the old "only once they've rolled"
            version) so this segment's presence never itself resizes the
            card — before a player's first roll it just reads "Rolled –",
            matching Dice.tsx's own dash placeholder for "no value yet".
            Re-keyed by the value itself, so each new roll (dash included)
            still gets its own little pop.
            Carries its own mini pip face (DicePipFace) alongside the
            text — per direct instruction, the roll-in-progress dice next
            to the card disappears the moment a turn ends (or, for a
            no-legal-move roll, can end in the very same broadcast that
            would've shown it at all), so a pip pattern shown only there
            was too easy to miss. This one is permanent, so it's always
            there to glance at instead of having to read the number. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={lastRoll ?? "none"}
            className="flex items-center gap-1 whitespace-nowrap"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={POP_TRANSITION}
            aria-label={lastRoll != null ? `Rolled ${lastRoll}` : "No roll yet"}
          >
            <span aria-hidden>·</span>
            {lastRoll != null && <DicePipFace value={lastRoll} />}
            <span aria-hidden>{lastRoll ?? "–"}</span>
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );

  // Fixed-width slot, always present, so the pill itself mounting/
  // unmounting as a turn starts and ends never changes the card's own
  // width — without this the whole card visibly grew and shrank every
  // single turn as players rotated through.
  const timerPill = (
    <div className="flex w-9 shrink-0 justify-center">
      <AnimatePresence>
        {isCurrentTurn && secondsLeft !== null && <TimerPill key="timer" isLow={isLow} secondsLeft={secondsLeft} />}
      </AnimatePresence>
    </div>
  );

  return (
    <motion.div
      className={`flex items-center gap-2 rounded-2xl border bg-surface p-2 shadow-elevation-1 transition-colors duration-200 ${
        isCurrentTurn ? `${classes.border} border-[1.5px]` : "border-hairline"
      }`}
      animate={{ scale: isCurrentTurn ? 1.03 : 1, opacity: isCurrentTurn ? 1 : 0.72 }}
      transition={POP_TRANSITION}
    >
      {isRight ? (
        <>
          {timerPill}
          {info}
          {avatar}
        </>
      ) : (
        <>
          {avatar}
          {info}
          {timerPill}
        </>
      )}
    </motion.div>
  );
}

function TimerPill({ isLow, secondsLeft }: { isLow: boolean; secondsLeft: number }) {
  return (
    <motion.div
      className={`shrink-0 rounded-full px-2 py-0.5 text-label-sm tabular-nums ${
        isLow ? "bg-quadrant-red-tint text-quadrant-red" : "bg-surface-container text-text-secondary"
      }`}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={POP_TRANSITION}
      role="timer"
      aria-live="polite"
    >
      {secondsLeft}s
    </motion.div>
  );
}

function StatusBadge({ player }: { player: Player }) {
  if (player.isBot || player.status === "bot") return <span>Bot</span>;
  if (player.status === "inactive") return <span>Inactive</span>;
  if (player.status === "disconnected") return <span>Disconnected</span>;
  return <span>Connected</span>;
}

export function pawnCountFor(roomState: GameRoomState, color: Player["color"]) {
  const pawns = roomState.pawns.filter((p) => p.color === color);
  return { finished: pawns.filter((p) => p.state === "finished").length, total: pawns.length };
}
