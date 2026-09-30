"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { boardSpecForPawns } from "@/lib/board/boardSpec";
import { isSafeCell, pathIndexToGlobalCell } from "@/lib/board/geometry";
import type { GameRoomState } from "@/lib/board/types";

/**
 * First-game tips for offline practice (docs/COMPETITIVE_ROADMAP.md F1.6):
 * a short hint at the moment it's useful. Each shows once per device, and
 * counts as seen once it's dismissed or its moment passes.
 */

const SEEN_KEY = "luddo-tips-seen";

// A string snapshot, so React sees the same value until it really changes.
function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function markSeen(id: string) {
  try {
    const seen = new Set(readSeen().split(",").filter(Boolean));
    seen.add(id);
    localStorage.setItem(SEEN_KEY, [...seen].join(","));
  } catch {}
}

const noSubscription = () => () => {};
// Before hydration, every tip counts as seen: nothing renders on the server.
const ALL_SEEN = "*";

interface Tip {
  id: string;
  text: string;
}

function activeTips(state: GameRoomState, myPlayerId: string | null): Tip[] {
  const me = state.players.find((p) => p.id === myPlayerId);
  if (!me || state.status !== "in_game") return [];
  const mine = state.pawns.filter((p) => p.color === me.color);
  const myTurn = state.turnPlayerId === me.id;
  const tips: Tip[] = [];
  if (state.gameType === "snakes_and_ladders") {
    if (myTurn && state.turnPhase === "awaiting_roll" && mine.every((p) => p.pathIndex === null))
      tips.push({ id: "snakes-six", text: "Roll a 6 to start. Your piece goes straight to square 6." });
    return tips;
  }
  if (myTurn && state.turnPhase === "awaiting_roll" && mine.every((p) => p.state === "nest"))
    tips.push({ id: "ludo-six", text: "Roll a 6 to bring a piece out of your base." });
  if (myTurn && state.turnPhase === "awaiting_move" && state.legalMoves.some((m) => m.capturesPawnIds.length > 0))
    tips.push({ id: "ludo-capture", text: "Land on that piece to send it back to its base, and earn another roll." });
  if (mine.some((p) => p.state === "track" && p.pathIndex !== null)) {
    const spec = boardSpecForPawns(state.pawns);
    const onStar = mine.some(
      (p) =>
        p.state === "track" &&
        p.pathIndex !== null &&
        isSafeCell(pathIndexToGlobalCell(me.color, p.pathIndex, spec), spec),
    );
    tips.push({
      id: "ludo-stars",
      text: onStar
        ? "You're on a star square: it's safe. No one can capture a piece standing on a star."
        : "Star squares are safe: no one can capture a piece standing on one.",
    });
  }
  return tips;
}

export function FirstGameTips({ state, myPlayerId }: { state: GameRoomState; myPlayerId: string | null }) {
  const seenRaw = useSyncExternalStore(noSubscription, readSeen, () => ALL_SEEN);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const seen = new Set([...seenRaw.split(","), ...dismissed]);
  const tip = seenRaw === ALL_SEEN ? undefined : activeTips(state, myPlayerId).find((t) => !seen.has(t.id));
  const tipId = tip?.id;

  // Once a tip has really been on screen, it counts as seen when it goes,
  // whether dismissed or because its moment passed. (The time check skips
  // React's development-only mount, unmount, mount.)
  useEffect(() => {
    if (!tipId) return;
    const shownAt = Date.now();
    return () => {
      if (Date.now() - shownAt > 400) markSeen(tipId);
    };
  }, [tipId]);

  if (!tip) return null;
  return (
    <div className="sim-tip" role="status">
      <p>{tip.text}</p>
      <button
        type="button"
        onClick={() => {
          markSeen(tip.id);
          setDismissed((ids) => [...ids, tip.id]);
        }}
      >
        Got it
      </button>
    </div>
  );
}
