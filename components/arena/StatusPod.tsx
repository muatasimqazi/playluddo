"use client";

import { QUADRANT_CLASSES, QUADRANT_INITIAL } from "@/components/shared/colors";
import { useCountdown } from "@/lib/hooks/useCountdown";
import { Dice } from "./Dice";
import type { GameRoomState, Player } from "@/lib/board/types";

// Inline dice next to the pod's own avatar+name — smaller than the
// DESIGN.md 56-64pt standalone dice so it doesn't dominate the compact pod.
const INLINE_DICE_SIZE = 40;

interface StatusPodProps {
  player: Player;
  pawnCount: { finished: number; total: number };
  isCurrentTurn: boolean;
  turnDeadlineAt: string | null;
  isYou: boolean;
  /** Mirrors the pod for the board's right-side quadrants (green/yellow), matching the reference layout. */
  align?: "left" | "right";
  /**
   * The dice roll functionality itself — per direct instruction, moved to
   * sit next to each player's own name card instead of a persistent
   * Control Center panel. Only meaningful (and only rendered) while it's
   * this pod's own turn; `diceValue`/`onRoll` are otherwise omitted.
   */
  dice?: {
    value: number | null;
    /** True only for the acting player's own pod, during their roll phase — everyone else's (and a mid-move) dice is a plain display. */
    canRoll: boolean;
    pending: boolean;
    onRoll: () => void;
  };
}

const DECISION_WINDOW_SECONDS = 15;
const AVATAR_SIZE = 36; // DESIGN.md "Player Status Pod": 36pt avatar circle
const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// DESIGN.md "Player Status Pod": passive opacity 0.72 with a plain hairline
// border; active turn state is full opacity, a 1.5pt player-color border,
// and a micro-scale of 1.03. The countdown ring depletes from the player's
// quadrant color into warning red as time runs low.
export function StatusPod({ player, pawnCount, isCurrentTurn, turnDeadlineAt, isYou, align = "left", dice }: StatusPodProps) {
  const classes = QUADRANT_CLASSES[player.color];
  const secondsLeft = useCountdown(isCurrentTurn ? turnDeadlineAt : null);
  const isLow = secondsLeft !== null && secondsLeft <= 5;
  const ringProgress = secondsLeft === null ? 1 : Math.max(0, Math.min(1, secondsLeft / DECISION_WINDOW_SECONDS));
  const isRight = align === "right";

  const avatar = (
    <div className="relative shrink-0" style={{ width: AVATAR_SIZE + 6, height: AVATAR_SIZE + 6 }}>
      {isCurrentTurn && secondsLeft !== null && (
        <svg
          width={AVATAR_SIZE + 6}
          height={AVATAR_SIZE + 6}
          viewBox={`0 0 ${AVATAR_SIZE + 6} ${AVATAR_SIZE + 6}`}
          className="absolute inset-0 -rotate-90"
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
          <circle
            cx={(AVATAR_SIZE + 6) / 2}
            cy={(AVATAR_SIZE + 6) / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={isLow ? "#EF4444" : `var(--quadrant-${player.color})`}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - ringProgress)}
            className="transition-[stroke-dashoffset] duration-200"
          />
        </svg>
      )}
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
      </div>
    </div>
  );

  // The dice roll control itself — appears only in the acting player's own
  // pod (isCurrentTurn), next to their name card, per direct instruction.
  // `dice.canRoll` is already scoped to "it's genuinely my own turn, and
  // the roll phase" by the caller, so passing the same prop to every pod
  // is safe: a bot's or opponent's pod can be isCurrentTurn without ever
  // being canRoll, so it only ever renders as a plain (non-clickable)
  // display of the shared roll value, never a control I can tap for them.
  const diceControl = isCurrentTurn && dice && (
    <Dice
      value={dice.value}
      playerColor={player.color}
      size={INLINE_DICE_SIZE}
      onRoll={dice.canRoll ? dice.onRoll : undefined}
      disabled={dice.pending}
    />
  );

  const outerSlot = (isCurrentTurn && secondsLeft !== null) || diceControl ? (
    <div className="flex shrink-0 flex-col items-center gap-1">
      {diceControl}
      {isCurrentTurn && secondsLeft !== null && <TimerPill isLow={isLow} secondsLeft={secondsLeft} />}
    </div>
  ) : null;

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border bg-surface p-2 shadow-elevation-1 transition-all ${
        isCurrentTurn ? `${classes.border} scale-103 border-[1.5px] opacity-100` : "border-hairline opacity-72"
      }`}
    >
      {isRight ? (
        <>
          {outerSlot}
          {info}
          {avatar}
        </>
      ) : (
        <>
          {avatar}
          {info}
          {outerSlot}
        </>
      )}
    </div>
  );
}

function TimerPill({ isLow, secondsLeft }: { isLow: boolean; secondsLeft: number }) {
  return (
    <div
      className={`shrink-0 rounded-full px-2 py-0.5 text-label-sm tabular-nums ${
        isLow ? "bg-quadrant-red-tint text-quadrant-red" : "bg-surface-container text-text-secondary"
      }`}
      role="timer"
      aria-live="polite"
    >
      {secondsLeft}s
    </div>
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
