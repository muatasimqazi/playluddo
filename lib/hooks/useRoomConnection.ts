"use client";

import { useEffect, useState } from "react";
import { createClient } from "../supabase/client";
import { ensureSession } from "../supabase/auth";
import { claimSeat, getRoomState, RpcError } from "../supabase/rpc";
import { fetchRecentEvents, subscribeToRoom } from "../realtime/room-channel";
import { useRoomStore } from "../store/room-store";

/**
 * Establishes this tab's control of a room: session -> claim_seat (issues a
 * fresh connection token, superseding any older tab per PRD 5.2) ->
 * get_room_state (authoritative snapshot) -> subscribe (docs/PRD.md Section
 * 6.3 — snapshot first, then subscribe, so a broadcast can never race the
 * initial fetch).
 */
export function useRoomConnection(roomId: string) {
  const [error, setError] = useState<RpcError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const setRoomState = useRoomStore((s) => s.setRoomState);
  const setEvents = useRoomStore((s) => s.setEvents);
  const setIdentity = useRoomStore((s) => s.setIdentity);
  const reset = useRoomStore((s) => s.reset);
  const [client] = useState(() => createClient());

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof subscribeToRoom> | null = null;

    async function refreshEvents() {
      try {
        const events = await fetchRecentEvents(client, roomId);
        if (!cancelled) setEvents(events);
      } catch {
        // Non-fatal — the event feed is a nice-to-have; state updates still work.
      }
    }

    async function connect() {
      try {
        await ensureSession(client);
        const { playerId, connectionToken } = await claimSeat(client, roomId);
        if (cancelled) return;
        setIdentity(playerId, connectionToken);

        const state = await getRoomState(client, roomId);
        if (cancelled) return;
        setRoomState(state);
        await refreshEvents();

        channel = subscribeToRoom(client, roomId, (nextState) => {
          setRoomState(nextState);
          void refreshEvents();
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void connect();

    return () => {
      cancelled = true;
      channel?.unsubscribe();
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roomId is the only thing that should re-trigger a connection
  }, [roomId]);

  return { client, loading, error };
}
