"use client";

import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { createClient } from "../supabase/client";
import { ensureSession } from "../supabase/auth";
import { isNativeApp } from "../native";
import { reportSeatBackgrounded } from "../push";
import { claimSeat, getRoomState, RpcError } from "../supabase/rpc";
import { fetchRecentEvents, subscribeToPlayerSignals, subscribeToRoom } from "../realtime/room-channel";
import { fetchTableMessages } from "../realtime/table-messages";
import { useRoomStore } from "../store/room-store";
import type { GameRoomState } from "../board/types";

/** Subscribe first, then reconcile a snapshot on every successful join/rejoin. */
export function useRoomConnection(roomId: string) {
  const [error, setError] = useState<RpcError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [client] = useState(() => createClient());

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof subscribeToRoom> | null = null;
    let signalChannel: ReturnType<typeof subscribeToPlayerSignals> | null = null;
    let refreshing = false;
    let refreshAgain = false;
    let subscribed = false;
    let currentProfile: { avatarId?: string; displayName?: string; country?: string } = {};
    const store = useRoomStore.getState;

    function withCurrentProfile(state: GameRoomState): GameRoomState {
      const playerId = store().myPlayerId;
      if (!playerId || !currentProfile.avatarId) return state;
      return {
        ...state,
        players: state.players.map((player) =>
          player.id === playerId
            ? {
                ...player,
                avatarId: currentProfile.avatarId,
                displayName: currentProfile.displayName || player.displayName,
                country: currentProfile.country || player.country,
              }
            : player,
        ),
      };
    }

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
        store().setRoomState(withCurrentProfile(state));
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
        const { data: userData } = await client.auth.getUser();
        const metadata = userData.user?.user_metadata;
        currentProfile = {
          avatarId: metadata?.avatar_id,
          displayName: metadata?.display_name,
          country: metadata?.country,
        };
        const { playerId, connectionToken } = await claimSeat(client, roomId);
        if (cancelled) return;
        store().setIdentity(playerId, connectionToken);
        // Party rooms deliver this seat's call signals privately (P8).
        signalChannel = subscribeToPlayerSignals(client, playerId, (signal) => {
          if (!cancelled) store().addVoiceSignal(signal);
        });
        channel = subscribeToRoom(
          client,
          roomId,
          (nextState) => {
            if (cancelled) return;
            store().setRoomState(withCurrentProfile(nextState));
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
            onPartyExtras: () => {
              if (!cancelled) store().partyExtrasChanged();
            },
          },
        );
        // Also load if realtime is temporarily unavailable; the HUD remains read-only.
        const state = await getRoomState(client, roomId);
        if (!cancelled) {
          store().setRoomState(withCurrentProfile(state));
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
      void signalChannel?.unsubscribe();
      store().reset();
    };
  }, [client, roomId]);

  // Tell the server when this seat's app goes to the background, so a "your
  // turn" push (F1.7) only reaches a player who isn't already looking. The
  // RPC does nothing for a caller without a seat here.
  useEffect(() => {
    const report = (backgrounded: boolean) => void reportSeatBackgrounded(client, roomId, backgrounded);
    const onVisibility = () => report(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    // The app shell's own signal, in case the web view doesn't fire visibilitychange.
    const appListener = isNativeApp()
      ? App.addListener("appStateChange", ({ isActive }) => report(!isActive))
      : null;
    report(document.visibilityState === "hidden");
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void appListener?.then((handle) => handle.remove());
      // Leaving the table screen with a seat still held counts as away.
      report(true);
    };
  }, [client, roomId]);

  return { client, loading, error };
}
