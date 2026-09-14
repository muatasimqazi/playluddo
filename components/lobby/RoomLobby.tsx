"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUADRANT_CLASSES, QUADRANT_INITIAL } from "@/components/shared/colors";
import { fillBot, startMatch } from "@/lib/supabase/rpc";
import { useRoomStore } from "@/lib/store/room-store";
import type { Player, PlayerColor } from "@/lib/board/types";

interface RoomLobbyProps {
  client: SupabaseClient;
  roomId: string;
}

const SEAT_COLORS: PlayerColor[] = ["red", "green", "yellow", "blue"];

export function RoomLobby({ client, roomId }: RoomLobbyProps) {
  const roomState = useRoomStore((s) => s.roomState);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!roomState) return null;

  const host = roomState.players.find((p) => p.seatIndex === 0) ?? null;
  const isHost = host?.id === myPlayerId;
  const seatedCount = roomState.players.length;
  const canStart = isHost && seatedCount >= 2;

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

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomState!.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied — the code is still visible on screen.
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <div className="flex items-center justify-between rounded-lg border border-hairline bg-surface p-3">
        <div>
          <p className="text-xs text-text-secondary">Room code</p>
          <p className="text-lg font-semibold tracking-wide text-foreground">{roomState.code}</p>
        </div>
        <button
          type="button"
          onClick={() => void copyCode()}
          className="rounded-md border border-hairline px-3 py-1.5 text-sm font-medium text-action"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {SEAT_COLORS.map((color, seatIndex) => {
          const player = roomState!.players.find((p) => p.seatIndex === seatIndex) ?? null;
          return (
            <SeatSlot
              key={color}
              color={color}
              player={player}
              isHost={isHost}
              pending={pending}
              onFillBot={() => void run(() => fillBot(client, roomId, seatIndex))}
            />
          );
        })}
      </div>

      {isHost ? (
        <button
          type="button"
          disabled={!canStart || pending}
          onClick={() => void run(() => startMatch(client, roomId))}
          className="rounded-lg bg-action px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {seatedCount < 2 ? "Waiting for at least 2 players…" : "Start Match"}
        </button>
      ) : (
        <p className="text-center text-sm text-text-secondary">Waiting for the host to start the match…</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-quadrant-red">
          {error}
        </p>
      )}
    </div>
  );
}

function SeatSlot({
  color,
  player,
  isHost,
  pending,
  onFillBot,
}: {
  color: PlayerColor;
  player: Player | null;
  isHost: boolean;
  pending: boolean;
  onFillBot: () => void;
}) {
  const classes = QUADRANT_CLASSES[color];

  if (!player) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 ${classes.border}`}>
        <span className={`text-xs font-medium uppercase ${classes.text}`}>{color} — empty</span>
        {isHost && (
          <button
            type="button"
            disabled={pending}
            onClick={onFillBot}
            className="rounded-md border border-hairline px-2 py-1 text-xs font-medium text-text-secondary disabled:opacity-40"
          >
            Fill with Bot
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border p-3 ${classes.border} ${classes.tint}`}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white ${classes.bg}`}>
        {QUADRANT_INITIAL[color]}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{player.displayName}</p>
        <p className="text-xs text-text-secondary">{player.isBot ? "Bot" : "Ready"}</p>
      </div>
    </div>
  );
}
