"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { QUADRANT_CLASSES } from "@/components/shared/colors";
import type { MatchEventRow } from "@/lib/realtime/room-channel";
import type { Player } from "@/lib/board/types";

interface ActivityFeedProps {
  events: MatchEventRow[];
  players: Player[];
}

/** PRD 5.2: concise event feed — rolls, moves, captures, home entries, bot takeovers, reconnects, win state. */
export function ActivityFeed({ events, players }: ActivityFeedProps) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  // Newest first, matching the reference's "Just now" → "4m ago" ordering.
  const ordered = [...events].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-1 pb-3">
        <span className="text-label-md text-foreground">Match Events</span>
        <span className="flex items-center gap-1 rounded-full bg-quadrant-green-tint px-2 py-0.5 text-label-sm text-quadrant-green">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-quadrant-green" aria-hidden />
          LIVE
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {ordered.length === 0 && <p className="px-1 text-body-sm text-text-muted">No events yet.</p>}
        {/* initial={false}: only events that arrive AFTER first mount get
            the slide-in — the feed a player joins mid-match to shouldn't
            cascade-animate its whole backlog in at once. */}
        <AnimatePresence initial={false}>
          {ordered.map((event) => {
            const player = event.player_id ? playerById.get(event.player_id) : undefined;
            return (
              <motion.div
                key={event.id}
                layout
                initial={{ opacity: 0, y: -14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ type: "spring", stiffness: 350, damping: 28 }}
                className="rounded-xl border border-hairline bg-surface p-2.5 shadow-elevation-1"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {player && (
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${QUADRANT_CLASSES[player.color].bg}`}
                        aria-hidden
                      />
                    )}
                    <span className="truncate text-label-md text-foreground">{player?.displayName ?? "Match"}</span>
                  </div>
                  <RelativeTime iso={event.created_at} />
                </div>
                <p className="text-body-sm text-text-secondary">{describeEvent(event)}</p>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  let label: string;
  if (seconds < 10) label = "Just now";
  else if (seconds < 60) label = `${seconds}s ago`;
  else if (seconds < 3600) label = `${Math.floor(seconds / 60)}m ago`;
  else label = `${Math.floor(seconds / 3600)}h ago`;

  return <span className="shrink-0 text-label-sm text-text-muted">{label}</span>;
}

function describeEvent(event: MatchEventRow): string {
  switch (event.event_type) {
    case "dice_rolled": {
      const value = event.payload?.dieValue;
      const cancelled = event.payload?.cancelledByThirdSix;
      return cancelled ? `rolled a ${value} — third six, turn ends` : `rolled a ${value}`;
    }
    case "legal_move_selected": {
      const captures = Array.isArray(event.payload?.capturesPawnIds) ? event.payload.capturesPawnIds.length : 0;
      const finished = event.payload?.finishesPawn;
      if (finished) return "brought a pawn home";
      if (captures > 0) return `captured ${captures} pawn${captures > 1 ? "s" : ""}`;
      return "moved a pawn";
    }
    case "match_started":
      return "match started";
    case "match_completed":
      return "won the match!";
    case "player_finished":
      return `finished in place ${event.payload?.place ?? ""}`.trim();
    case "match_abandoned":
      return "match ended — no active players remained";
    case "player_reconnected":
      return "reconnected";
    case "rematch_requested":
      return "requested a rematch";
    case "rematch_accepted_vote":
      return "accepted the rematch";
    case "rematch_accepted":
      return "rematch starting — back to the lobby";
    default:
      return event.event_type;
  }
}
