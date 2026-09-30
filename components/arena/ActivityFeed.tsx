"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import type { MatchEventRow } from "@/lib/realtime/room-channel";
import type { Player } from "@/lib/board/types";
import { useT, type Translator } from "@/lib/i18n";

interface ActivityFeedProps {
  events: MatchEventRow[];
  players: Player[];
}

/** PRD 5.2: concise event feed — rolls, moves, captures, home entries, bot takeovers, reconnects, win state. */
export function ActivityFeed({ events, players }: ActivityFeedProps) {
  const t = useT();
  const playerById = new Map(players.map((p) => [p.id, p]));
  // Newest first, matching the reference's "Just now" → "4m ago" ordering.
  const ordered = [...events].reverse();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-1 pb-3">
        <span className="text-label-md text-foreground">{t("game.matchEvents")}</span>
        <span className="flex items-center gap-1 rounded-full bg-quadrant-green-tint px-2 py-0.5 text-label-sm text-quadrant-green">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-quadrant-green" aria-hidden />
          {t("game.live").toUpperCase()}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {ordered.length === 0 && <p className="px-1 text-body-sm text-text-muted">{t("game.noEventsYet")}</p>}
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
                    {player && <PlayerAvatar player={player} size={24} />}
                    <span className="truncate text-label-md text-foreground">{player?.displayName ?? t("game.match")}</span>
                  </div>
                  <RelativeTime iso={event.created_at} t={t} />
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

function RelativeTime({ iso, t }: { iso: string; t: Translator }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  let label: string;
  if (seconds < 10) label = t("game.justNow");
  else if (seconds < 60) label = t("game.secondsAgo", { seconds });
  else if (seconds < 3600) label = t("game.minutesAgo", { minutes: Math.floor(seconds / 60) });
  else label = t("game.hoursAgo", { hours: Math.floor(seconds / 3600) });

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
    case "match_paused":
      return "paused the match";
    case "match_resumed":
      return "resumed the match";
    case "match_completed":
      return "won the match!";
    case "player_finished":
      return `finished in place ${event.payload?.place ?? ""}`.trim();
    case "match_abandoned":
      return "match ended — no active players remained";
    case "player_reconnected":
      return "reconnected";
    case "decision_timed_out":
      return "ran out of time";
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
