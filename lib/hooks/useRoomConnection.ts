"use client";

import { useEffect, useState } from "react";
import { createClient } from "../supabase/client";
import { ensureSession } from "../supabase/auth";
import { claimSeat, getRoomState, RpcError } from "../supabase/rpc";
import { fetchRecentEvents, subscribeToRoom } from "../realtime/room-channel";
import { fetchTableMessages } from "../realtime/table-messages";
import { useRoomStore } from "../store/room-store";

/** Subscribe first, then reconcile a snapshot on every successful join/rejoin. */
export function useRoomConnection(roomId: string) {
  const [error, setError] = useState<RpcError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [client] = useState(() => createClient());

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof subscribeToRoom> | null = null;
    let refreshing = false;
    let refreshAgain = false;
    let subscribed = false;
    const store = useRoomStore.getState;

    async function refreshEvents() {
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      try {
        do {
          refreshAgain = false;
          const events = await fetchRecentEvents(client, roomId);
          if (!cancelled) store().setEvents(events);
        } while (refreshAgain && !cancelled);
      } catch {
        /* A later snapshot retries the durable log. */
      } finally {
        refreshing = false;
      }
    }
    async function synchronize() {
      try {
        const state = await getRoomState(client, roomId);
        if (cancelled) return;
        store().setRoomState(state);
        await refreshEvents();
        if (!cancelled) {
          store().setConnection(subscribed ? "connected" : "reconnecting");
          setError(null);
          setLoading(false);
        }
        try {
          const messages = await fetchTableMessages(client, roomId);
          if (!cancelled) messages.forEach(store().addMessage);
        } catch {
          /* Old deployments can play while the chat migration is pending. */
        }
      } catch (err) {
        if (!cancelled) {
          store().setConnection("reconnecting");
          if (!store().roomState) {
            setError(err instanceof Error ? err : new Error(String(err)));
            setLoading(false);
          }
        }
      }
    }
    async function connect() {
      try {
        await ensureSession(client);
        const { playerId, connectionToken } = await claimSeat(client, roomId);
        if (cancelled) return;
        store().setIdentity(playerId, connectionToken);
        channel = subscribeToRoom(
          client,
          roomId,
          (nextState) => {
            if (cancelled) return;
            store().setRoomState(nextState);
            void refreshEvents();
          },
          {
            onStatus: (status) => {
              if (cancelled) return;
              if (status === "SUBSCRIBED") {
                subscribed = true;
                void synchronize();
              } else if (
                ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)
              ) {
                subscribed = false;
                store().setConnection("reconnecting");
              }
            },
            onMessage: (message) => {
              if (!cancelled) store().addMessage(message);
            },
            onSignal: (signal) => {
              if (!cancelled) store().addVoiceSignal(signal);
            },
          },
        );
        // Also load if realtime is temporarily unavailable; the HUD remains read-only.
        const state = await getRoomState(client, roomId);
        if (!cancelled) {
          store().setRoomState(state);
          await refreshEvents();
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    }
    const offline = () => store().setConnection("reconnecting");
    const resume = () => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void synchronize();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    const retry = setInterval(() => {
      if (
        !cancelled &&
        store().connection !== "connected" &&
        store().myPlayerId &&
        navigator.onLine
      )
        void synchronize();
    }, 5000);
    void connect();
    return () => {
      cancelled = true;
      clearInterval(retry);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      void channel?.unsubscribe();
      store().reset();
    };
  }, [client, roomId]);

  return { client, loading, error };
}
