"use client";

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { partyHeartbeat } from "../supabase/rpc";

/**
 * "Still here" from a Party Mode phone every 10 seconds, in the lobby and
 * during the game (docs/COMPETITIVE_ROADMAP.md P2 and P5): the VIP role
 * moves on if the VIP leaves, and a table waiting for this phone resumes.
 * It also beats the moment the phone is unlocked or back online, so a
 * waiting table doesn't wait for the next tick.
 */
export function usePartyHeartbeat(client: SupabaseClient, roomId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const beat = () => void partyHeartbeat(client, roomId).catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    beat();
    const timer = setInterval(beat, 10_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", beat);
    };
  }, [client, roomId, enabled]);
}
