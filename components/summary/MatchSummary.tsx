"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUADRANT_CLASSES, QUADRANT_INITIAL } from "@/components/shared/colors";
import { acceptRematch, requestRematch } from "@/lib/supabase/rpc";
import { rankPlayers, type PlayerProgress } from "@/lib/board/rules";
import { useRoomStore } from "@/lib/store/room-store";

interface MatchSummaryProps {
  client: SupabaseClient;
  roomId: string;
}

export function MatchSummary({ client, roomId }: MatchSummaryProps) {
  const router = useRouter();
  const roomState = useRoomStore((s) => s.roomState);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ranking = useMemo(() => {
    if (!roomState) return [];
    const progress: PlayerProgress[] = roomState.players.map((player) => {
      const pawns = roomState.pawns.filter((p) => p.color === player.color);
      return {
        id: player.id,
        pawnsFinished: pawns.filter((p) => p.state === "finished").length,
        totalProgress: pawns.reduce((sum, p) => sum + (p.pathIndex ?? 0), 0),
        turnOrder: player.seatIndex,
      };
    });
    return rankPlayers(progress);
  }, [roomState]);

  if (!roomState) return null;

  const playerById = new Map(roomState.players.map((p) => [p.id, p]));
  const myPlayer = playerById.get(myPlayerId ?? "") ?? null;
  const isAbandoned = roomState.status === "abandoned" || roomState.matchEndReason === "abandoned";

  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const rematchAction = !myPlayer
    ? null
    : myPlayer.rematchReady
      ? { label: "Waiting for others…", disabled: true, onClick: () => {} }
      : roomState.players.some((p) => p.rematchReady)
        ? { label: "Accept Rematch", disabled: false, onClick: () => run(() => acceptRematch(client, roomId)) }
        : { label: "Request Rematch", disabled: false, onClick: () => run(() => requestRematch(client, roomId)) };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <div className="rounded-lg border border-hairline bg-surface p-4 text-center">
        <p className="text-sm font-medium text-action">{isAbandoned ? "Match Abandoned" : "Victory!"}</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">
          {isAbandoned
            ? "No active players remained"
            : `${playerById.get(roomState.winnerIds[0])?.displayName ?? "A player"} is the champion!`}
        </h1>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3">
        <h2 className="text-sm font-semibold text-foreground">Final Standings</h2>
        {ranking.map((playerId, index) => {
          const player = playerById.get(playerId);
          if (!player) return null;
          const classes = QUADRANT_CLASSES[player.color];
          const pawns = roomState.pawns.filter((p) => p.color === player.color);
          const finished = pawns.filter((p) => p.state === "finished").length;
          return (
            <div key={playerId} className="flex items-center gap-2">
              <span className="w-5 text-sm font-semibold text-text-secondary">{index + 1}</span>
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ${classes.bg}`}>
                {QUADRANT_INITIAL[player.color]}
              </div>
              <span className="flex-1 truncate text-sm text-foreground">
                {player.displayName} {player.id === myPlayerId && "(You)"}
              </span>
              <span className="text-xs text-text-secondary">{finished}/4 home</span>
            </div>
          );
        })}
      </div>

      {!isAbandoned && rematchAction && (
        <button
          type="button"
          disabled={pending || rematchAction.disabled}
          onClick={rematchAction.onClick}
          className="rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {rematchAction.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => router.push("/")}
        className="rounded-lg border border-hairline px-4 py-2.5 text-sm font-medium text-foreground"
      >
        Return to Lobby
      </button>

      {error && (
        <p role="alert" className="text-center text-sm text-quadrant-red">
          {error}
        </p>
      )}
    </div>
  );
}
