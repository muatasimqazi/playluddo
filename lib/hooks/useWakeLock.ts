"use client";

import { useEffect } from "react";

/**
 * Keeps the screen awake while mounted (the Party screen on a TV or laptop).
 * Browsers drop the lock when the page is hidden, so it's taken again on
 * return. Where the Screen Wake Lock API is missing, this does nothing.
 */
export function useWakeLock() {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((next) => {
          if (cancelled) void next.release();
          else lock = next;
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release().catch(() => {});
    };
  }, []);
}
