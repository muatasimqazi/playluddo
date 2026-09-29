"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getMyMatchHistory, type MatchHistoryEntry } from "@/lib/supabase/replay";
import { Icon } from "@/components/simulator/Icon";

function place(n: number | null): string {
  if (n === null) return "Unfinished";
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Recent finished matches with a replay link (docs/COMPETITIVE_ROADMAP.md F4.3). */
export function MatchHistory() {
  const client = useMemo(() => createClient(), []);
  const [matches, setMatches] = useState<MatchHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getMyMatchHistory(client, 10);
        if (!cancelled) setMatches(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load your matches.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  if (error || (matches && matches.length === 0)) return null;

  return (
    <section>
      <span className="eyebrow">RECENT MATCHES</span>
      <div className="match-history">
        {(matches ?? []).map((match) => {
          const others = match.opponents.filter(Boolean);
          const summary =
            others.length > 0
              ? `vs ${others.slice(0, 2).join(", ")}${others.length > 2 ? ` +${others.length - 2}` : ""}`
              : `${match.playerCount} players`;
          return (
            <Link
              key={match.matchId}
              href={`/replay?match=${match.matchId}`}
              className="match-history-row"
            >
              <Icon name={match.gameType === "snakes_and_ladders" ? "grid" : "play"} size={16} />
              <span className="match-history-when">
                <strong>
                  {match.gameType === "snakes_and_ladders" ? "Snakes & Ladders" : "Ludo"} · {summary}
                </strong>
                <small>{when(match.endedAt)}</small>
              </span>
              {match.endReason === "completed" && (
                <span className="match-history-place">{place(match.placement)}</span>
              )}
              <Icon name="replay" size={15} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
