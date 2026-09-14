"use client";

import { useEffect, useState } from "react";

/**
 * Seconds remaining until `deadlineIso`, updated every 250ms. Purely a
 * display concern — the server (`turn_deadline_at` + the sweep job) is the
 * actual authority on when a turn times out; this never drives game logic.
 */
export function useCountdown(deadlineIso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadlineIso) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [deadlineIso]);

  if (!deadlineIso) return null;
  const remainingMs = new Date(deadlineIso).getTime() - now;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}
