"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RpcError,
  requestMove,
  requestRoll,
  toggleAutoRoll,
  requestRematch,
  acceptRematch,
  reclaimSeat,
  toggleMatchPause,
} from "@/lib/supabase/rpc";
import { useRoomStore } from "@/lib/store/room-store";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import { TableLoading } from "@/components/simulator/TableLoading";
// Eagerly loaded here, not just inside the dynamic Simulator below, so the
// loading fallback's own styling (the die animation) is available
// immediately instead of arriving with the same lazy chunk it stands in for.
import "@/components/simulator/simulator.css";

const Simulator = dynamic(() => import("@/components/simulator/Simulator"), {
  ssr: false,
  loading: () => <TableLoading label="Joining the table…" />,
});

export function MatchArena({
  client,
  roomId,
  voice,
}: {
  client: SupabaseClient;
  roomId: string;
  voice?: VoiceChat;
}) {
  const state = useRoomStore((s) => s.roomState);
  const events = useRoomStore((s) => s.events);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const connectionToken = useRoomStore((s) => s.connectionToken);
  const sessionReplaced = useRoomStore((s) => s.sessionReplaced);
  const setSessionReplaced = useRoomStore((s) => s.setSessionReplaced);
  const connection = useRoomStore((s) => s.connection);
  const messages = useRoomStore((s) => s.messages);
  const addMessage = useRoomStore((s) => s.addMessage);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>) {
    if (pending || sessionReplaced) return;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof RpcError && e.code === "SESSION_REPLACED")
        setSessionReplaced();
      else
        setError(
          e instanceof Error ? e.message : "The action could not be completed.",
        );
    } finally {
      setPending(false);
    }
  }
  if (!state) return null;
  return (
    <Simulator
      state={state}
      events={events}
      myPlayerId={myPlayerId}
      pending={pending}
      error={error}
      readOnly={sessionReplaced}
      connection={connection}
      messages={messages}
      onMessage={async (text, kind) => {
        const { data, error } = await client.rpc("send_table_message", {
          p_room_id: roomId,
          p_text: text,
          p_kind: kind,
        });
        if (error)
          throw new Error(
            error.code === "PGRST202"
              ? "Table chat needs the latest database migration."
              : error.message,
          );
        addMessage(data);
      }}
      onRoll={() => act(() => requestRoll(client, roomId, connectionToken))}
      onMove={(id) =>
        act(() => requestMove(client, roomId, id, connectionToken))
      }
      onRematch={() =>
        act(() =>
          state.players.some((p) => p.rematchReady)
            ? acceptRematch(client, roomId)
            : requestRematch(client, roomId),
        )
      }
      onReclaim={() => act(() => reclaimSeat(client, roomId))}
      onAutoRoll={(enabled) =>
        act(() => toggleAutoRoll(client, roomId, enabled))
      }
      paused={state.paused}
      canPause={state.hostPlayerId === myPlayerId}
      onPause={(paused) =>
        act(async () => {
          const next = await toggleMatchPause(client, roomId, paused);
          useRoomStore.getState().setRoomState(next);
        })
      }
      voice={voice}
    />
  );
}
