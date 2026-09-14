"use client";

import type { MatchEventRow } from "@/lib/realtime/room-channel";
import type { Player } from "@/lib/board/types";

interface ActivityFeedProps {
  events: MatchEventRow[];
  players: Player[];
}

/** PRD 5.2: concise event feed — rolls, moves, captures, home entries, bot takeovers, reconnects, win state. */
export function ActivityFeed({ events, players }: ActivityFeedProps) {
  const playerById = new Map(players.map((p) => [p.id, p]));

  return (
    <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-hairline bg-surface p-2 text-xs">
      {events.length === 0 && <p className="text-text-muted">No events yet.</p>}
      {events.map((event) => (
        <p key={event.id} className="text-text-secondary">
          <span className="font-medium text-foreground">
            {event.player_id ? (playerById.get(event.player_id)?.displayName ?? "Someone") : "Match"}
          </span>{" "}
          {describeEvent(event)}
        </p>
      ))}
    </div>
  );
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
