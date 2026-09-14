"use client";

import { QUADRANT_CLASSES, QUADRANT_INITIAL } from "@/components/shared/colors";
import { useCountdown } from "@/lib/hooks/useCountdown";
import type { GameRoomState, Player } from "@/lib/board/types";

interface StatusPodProps {
  player: Player;
  pawnCount: { finished: number; total: number };
  isCurrentTurn: boolean;
  turnDeadlineAt: string | null;
  isYou: boolean;
}

const DECISION_WINDOW_SECONDS = 15;
const AVATAR_SIZE = 36; // DESIGN.md "Player Status Pod": 36pt avatar circle
const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// DESIGN.md "Player Status Pod": passive opacity 0.72 with a plain hairline
// border; active turn state is full opacity, a 1.5pt player-color border,
// and a micro-scale of 1.03. The countdown ring depletes from the player's
// quadrant color into warning red as time runs low.
export function StatusPod({ player, pawnCount, isCurrentTurn, turnDeadlineAt, isYou }: StatusPodProps) {
  const classes = QUADRANT_CLASSES[player.color];
  const secondsLeft = useCountdown(isCurrentTurn ? turnDeadlineAt : null);
  const isLow = secondsLeft !== null && secondsLeft <= 5;
  const ringProgress = secondsLeft === null ? 1 : Math.max(0, Math.min(1, secondsLeft / DECISION_WINDOW_SECONDS));

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-2 transition-all ${
        isCurrentTurn ? `${classes.border} scale-103 border-[1.5px] opacity-100` : "border-hairline opacity-72"
      }`}
    >
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
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body-sm font-medium text-foreground">{player.displayName}</span>
          {isYou && (
            <span className="shrink-0 rounded-full bg-action px-1.5 py-0.5 text-label-sm text-white">YOU</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-label-sm text-text-secondary">
          <StatusBadge player={player} />
          <span aria-hidden>·</span>
          <span>
            {pawnCount.finished}/{pawnCount.total} home
          </span>
        </div>
      </div>
      {isCurrentTurn && secondsLeft !== null && (
        <div
          className={`shrink-0 rounded-full px-2 py-0.5 text-label-sm tabular-nums ${
            isLow ? "bg-quadrant-red-tint text-quadrant-red" : "bg-surface-container text-text-secondary"
          }`}
          role="timer"
          aria-live="polite"
        >
          {secondsLeft}s
        </div>
      )}
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
