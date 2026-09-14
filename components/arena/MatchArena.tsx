"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Board } from "./Board";
import { Dice } from "./Dice";
import { StatusPod, pawnCountFor } from "./StatusPod";
import { ActivityFeed } from "./ActivityFeed";
import { QUADRANT_CLASSES } from "@/components/shared/colors";
import { RpcError, requestMove, requestRoll, toggleAutoRoll } from "@/lib/supabase/rpc";
import { useRoomStore } from "@/lib/store/room-store";
import type { GameRoomState } from "@/lib/board/types";

interface MatchArenaProps {
  client: SupabaseClient;
  roomId: string;
}

export function MatchArena({ client, roomId }: MatchArenaProps) {
  const roomState = useRoomStore((s) => s.roomState);
  const events = useRoomStore((s) => s.events);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const connectionToken = useRoomStore((s) => s.connectionToken);
  const setSessionReplaced = useRoomStore((s) => s.setSessionReplaced);
  const sessionReplaced = useRoomStore((s) => s.sessionReplaced);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const myPlayer = roomState?.players.find((p) => p.id === myPlayerId) ?? null;
  const isMyTurn = roomState !== null && roomState.turnPlayerId === myPlayerId;
  const legalPawnIds = useMemo(
    () => new Set(isMyTurn && roomState ? roomState.legalMoves.map((m) => m.pawnId) : []),
    [roomState, isMyTurn],
  );

  if (!roomState) return null;

  const canRoll = isMyTurn && roomState.turnPhase === "awaiting_roll" && !myPlayer?.autoRollEnabled;
  const canChoosePawn = isMyTurn && roomState.turnPhase === "awaiting_move";

  async function handleAction(fn: () => Promise<unknown>) {
    setPending(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof RpcError && err.code === "SESSION_REPLACED") {
        setSessionReplaced();
      } else {
        setActionError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {sessionReplaced && (
        <div
          role="alert"
          className="rounded-md border border-quadrant-red-border bg-quadrant-red-tint p-2 text-sm text-quadrant-red"
        >
          This seat is now controlled from another tab or device.
        </div>
      )}

      {/* DESIGN.md: "organized top-to-bottom in a 2x2 split dock depending on portrait orientation limits" */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {roomState.players.map((player) => (
          <StatusPod
            key={player.id}
            player={player}
            pawnCount={pawnCountFor(roomState, player.color)}
            isCurrentTurn={roomState.turnPlayerId === player.id}
            turnDeadlineAt={roomState.turnDeadlineAt}
            isYou={player.id === myPlayerId}
          />
        ))}
      </div>

      <Board
        roomState={roomState}
        legalPawnIds={legalPawnIds}
        onSelectPawn={(pawnId) => void handleAction(() => requestMove(client, roomId, pawnId, connectionToken))}
      />

      <div className="flex flex-col items-center gap-3 rounded-lg border border-hairline bg-surface p-4 shadow-elevation-1">
        <Dice value={roomState.activeDiceValue} playerColor={myPlayer?.color ?? "red"} />
        <p className="text-body-sm text-text-secondary" aria-live="polite">
          {statusMessage(isMyTurn, canRoll, canChoosePawn, roomState.status)}
        </p>
        {canRoll && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void handleAction(() => requestRoll(client, roomId, connectionToken))}
            className={`h-12.5 w-full max-w-xs rounded-md text-label-lg text-white shadow-elevation-2 transition-transform active:scale-97 disabled:opacity-50 ${
              myPlayer ? QUADRANT_CLASSES[myPlayer.color].bg : "bg-action"
            }`}
          >
            Roll Dice
          </button>
        )}
        {myPlayer && !myPlayer.isBot && (
          <label className="flex items-center gap-2 text-body-sm text-text-secondary">
            <input
              type="checkbox"
              checked={myPlayer.autoRollEnabled}
              onChange={(e) => void handleAction(() => toggleAutoRoll(client, roomId, e.target.checked))}
            />
            Auto-Roll (let the server play for me)
          </label>
        )}
        {actionError && (
          <p role="alert" className="text-body-sm text-quadrant-red">
            {actionError}
          </p>
        )}
      </div>

      <ActivityFeed events={events} players={roomState.players} />
    </div>
  );
}

function statusMessage(
  isMyTurn: boolean,
  canRoll: boolean,
  canChoosePawn: boolean,
  status: GameRoomState["status"],
): string {
  if (status !== "in_game") return "";
  if (!isMyTurn) return "Waiting for the current player…";
  if (canRoll) return "Your turn — roll the dice.";
  if (canChoosePawn) return "Choose a highlighted pawn to move.";
  return "Waiting…";
}
