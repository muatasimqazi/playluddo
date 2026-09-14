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
import type { GameRoomState, Player, PlayerColor } from "@/lib/board/types";

interface MatchArenaProps {
  client: SupabaseClient;
  roomId: string;
}

// Quadrant layout, top-left/top-right/bottom-left/bottom-right — matches
// BASE_AREA in boardLayout.ts, so a seat's status pod sits on the same side
// of the board as its own base.
const QUADRANT_SLOTS: readonly { color: PlayerColor; corner: "tl" | "tr" | "bl" | "br" }[] = [
  { color: "red", corner: "tl" },
  { color: "green", corner: "tr" },
  { color: "blue", corner: "bl" },
  { color: "yellow", corner: "br" },
];

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
  const playerByColor = new Map(roomState.players.map((p) => [p.color, p]));

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

  function podFor(room: GameRoomState, color: PlayerColor, align: "left" | "right") {
    const player = playerByColor.get(color);
    if (!player) return <div />;
    return (
      <StatusPod
        player={player}
        pawnCount={pawnCountFor(room, color)}
        isCurrentTurn={room.turnPlayerId === player.id}
        turnDeadlineAt={room.turnDeadlineAt}
        isYou={player.id === myPlayerId}
        align={align}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-3 sm:p-4 lg:h-[calc(100vh-2rem)] lg:flex-row">
      {/* LEFT: Match Events */}
      <aside className="order-3 hidden w-64 shrink-0 rounded-2xl border border-hairline bg-surface p-3 shadow-elevation-1 xl:order-1 xl:flex xl:min-h-0 xl:flex-col">
        <ActivityFeed events={events} players={roomState.players} />
      </aside>

      {/* CENTER: status pods + board */}
      <section className="order-1 flex flex-1 flex-col items-center gap-3 overflow-y-auto xl:order-2">
        {sessionReplaced && (
          <div
            role="alert"
            className="w-full max-w-[580px] rounded-md border border-quadrant-red-border bg-quadrant-red-tint p-2 text-center text-body-sm text-quadrant-red"
          >
            This seat is now controlled from another tab or device.
          </div>
        )}

        <div className="flex w-full max-w-[580px] items-center justify-between gap-2">
          {podFor(roomState, QUADRANT_SLOTS[0].color, "left")}
          {podFor(roomState, QUADRANT_SLOTS[1].color, "right")}
        </div>

        <Board
          roomState={roomState}
          legalPawnIds={legalPawnIds}
          onSelectPawn={(pawnId) => void handleAction(() => requestMove(client, roomId, pawnId, connectionToken))}
        />

        <div className="flex w-full max-w-[580px] items-center justify-between gap-2">
          {podFor(roomState, QUADRANT_SLOTS[2].color, "left")}
          {podFor(roomState, QUADRANT_SLOTS[3].color, "right")}
        </div>

        {/* Below lg, the control center collapses into the flow here. */}
        <div className="w-full max-w-[580px] lg:hidden">
          <ControlCenter
            roomState={roomState}
            myPlayer={myPlayer}
            isMyTurn={isMyTurn}
            canRoll={canRoll}
            canChoosePawn={canChoosePawn}
            pending={pending}
            actionError={actionError}
            onRoll={() => void handleAction(() => requestRoll(client, roomId, connectionToken))}
            onToggleAutoRoll={(checked) => void handleAction(() => toggleAutoRoll(client, roomId, checked))}
          />
        </div>
      </section>

      {/* RIGHT: Control Center */}
      <aside className="order-2 hidden w-72 shrink-0 rounded-2xl border border-hairline bg-surface p-4 shadow-elevation-1 lg:order-3 lg:flex lg:min-h-0 lg:flex-col lg:overflow-y-auto">
        <ControlCenter
          roomState={roomState}
          myPlayer={myPlayer}
          isMyTurn={isMyTurn}
          canRoll={canRoll}
          canChoosePawn={canChoosePawn}
          pending={pending}
          actionError={actionError}
          onRoll={() => void handleAction(() => requestRoll(client, roomId, connectionToken))}
          onToggleAutoRoll={(checked) => void handleAction(() => toggleAutoRoll(client, roomId, checked))}
        />
      </aside>
    </div>
  );
}

function ControlCenter({
  roomState,
  myPlayer,
  isMyTurn,
  canRoll,
  canChoosePawn,
  pending,
  actionError,
  onRoll,
  onToggleAutoRoll,
}: {
  roomState: GameRoomState;
  myPlayer: Player | null;
  isMyTurn: boolean;
  canRoll: boolean;
  canChoosePawn: boolean;
  pending: boolean;
  actionError: string | null;
  onRoll: () => void;
  onToggleAutoRoll: (checked: boolean) => void;
}) {
  const standings = [...roomState.players]
    .map((player) => ({ player, count: pawnCountFor(roomState, player.color) }))
    .sort((a, b) => b.count.finished - a.count.finished);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-label-sm tracking-wide text-text-muted uppercase">Control Center</p>
        <p className="mt-0.5 text-label-md text-foreground">Turn Actions</p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-2xl border border-hairline bg-surface p-4 shadow-elevation-1">
        <Dice value={roomState.activeDiceValue} playerColor={myPlayer?.color ?? "red"} />
        <p className="text-center text-body-sm text-text-secondary" aria-live="polite">
          {statusMessage(isMyTurn, canRoll, canChoosePawn, roomState.status)}
        </p>
      </div>

      {canRoll && (
        <button
          type="button"
          disabled={pending}
          onClick={onRoll}
          className={`h-12.5 w-full rounded-xl text-label-lg text-white shadow-elevation-2 transition-transform active:scale-97 disabled:opacity-50 ${
            myPlayer ? QUADRANT_CLASSES[myPlayer.color].bg : "bg-action"
          }`}
        >
          Roll Dice
        </button>
      )}

      {myPlayer && !myPlayer.isBot && (
        <div className="flex items-center justify-between rounded-xl border border-hairline bg-surface px-3.5 py-2.5 shadow-elevation-1">
          <span className="text-body-sm text-foreground">Auto-Roll</span>
          <label className="ios-switch">
            <input
              type="checkbox"
              checked={myPlayer.autoRollEnabled}
              onChange={(e) => onToggleAutoRoll(e.target.checked)}
            />
            <span className="ios-slider" />
          </label>
        </div>
      )}

      {actionError && (
        <p role="alert" className="text-body-sm text-quadrant-red">
          {actionError}
        </p>
      )}

      <div className="flex flex-col gap-2.5 border-t border-hairline pt-4">
        <span className="text-label-sm tracking-wide text-text-muted uppercase">Game Standings</span>
        {standings.map(({ player, count }) => (
          <StandingRow key={player.id} player={player} count={count} isYou={player.id === myPlayer?.id} />
        ))}
      </div>
    </div>
  );
}

function StandingRow({
  player,
  count,
  isYou,
}: {
  player: Player;
  count: { finished: number; total: number };
  isYou: boolean;
}) {
  const classes = QUADRANT_CLASSES[player.color];
  if (isYou) {
    return (
      <div className="rounded-xl border border-hairline bg-surface p-2.5 shadow-elevation-1">
        <div className="mb-1.5 flex items-center justify-between text-body-sm">
          <div className="flex items-center gap-2">
            <span className={`h-3 w-3 shrink-0 rounded-full ${classes.bg}`} aria-hidden />
            <span className="text-label-md text-foreground">{player.displayName} (You)</span>
          </div>
          <span className={`text-label-sm ${classes.text}`}>
            {count.finished} / {count.total}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
          <div
            className={`h-full rounded-full ${classes.bg}`}
            style={{ width: `${(count.finished / count.total) * 100}%` }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between px-2 py-1 text-body-sm">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 shrink-0 rounded-full ${classes.bg}`} aria-hidden />
        <span className="text-text-secondary">{player.displayName}</span>
      </div>
      <span className="text-label-sm text-text-muted">
        {count.finished} / {count.total}
      </span>
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
