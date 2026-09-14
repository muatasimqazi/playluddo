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

export function StatusPod({ player, pawnCount, isCurrentTurn, turnDeadlineAt, isYou }: StatusPodProps) {
  const classes = QUADRANT_CLASSES[player.color];
  const secondsLeft = useCountdown(isCurrentTurn ? turnDeadlineAt : null);

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-2 transition-opacity ${
        isCurrentTurn ? `${classes.border} opacity-100` : "border-hairline opacity-70"
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${classes.bg}`}
        aria-hidden
      >
        {QUADRANT_INITIAL[player.color]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{player.displayName}</span>
          {isYou && <span className="rounded-full bg-action px-1.5 py-0.5 text-[10px] font-semibold text-white">YOU</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <StatusBadge player={player} />
          <span>· {pawnCount.finished}/{pawnCount.total} home</span>
        </div>
      </div>
      {isCurrentTurn && secondsLeft !== null && (
        <div
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
            secondsLeft <= 5 ? "bg-red-100 text-quadrant-red" : "bg-gray-100 text-text-secondary"
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
