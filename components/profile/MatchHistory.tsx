"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getMyMatchHistory, type MatchHistoryEntry } from "@/lib/supabase/replay";
import { Icon } from "@/components/simulator/Icon";
import { useI18n, type LocaleCode, type Translator } from "@/lib/i18n";

function place(t: Translator, n: number | null): string {
  if (n === null) return t("profile.unfinished");
  if (n === 1) return t("tournaments.place1");
  if (n === 2) return t("tournaments.place2");
  if (n === 3) return t("tournaments.place3");
  return t("profile.ordinalNth", { n });
}

function when(iso: string, locale: LocaleCode): string {
  return new Date(iso).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Recent finished matches with a replay link (docs/COMPETITIVE_ROADMAP.md F4.3). */
export function MatchHistory() {
  const { t, locale } = useI18n();
  const client = useMemo(() => createClient(), []);
  const [matches, setMatches] = useState<MatchHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getMyMatchHistory(client, 10);
        if (!cancelled) setMatches(data);
      } catch {
        // The section hides itself on error; nothing to show the player.
        if (!cancelled) setError("error");
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
      <span className="eyebrow">{t("profile.recentMatches").toUpperCase()}</span>
      <div className="match-history">
        {(matches ?? []).map((match) => {
          const others = match.opponents.filter(Boolean);
          const names =
            others.slice(0, 2).join(", ") + (others.length > 2 ? ` +${others.length - 2}` : "");
          const summary =
            others.length > 0
              ? t("profile.summaryVs", { names })
              : t("profile.summaryPlayers", { count: match.playerCount });
          return (
            <Link
              key={match.matchId}
              href={`/replay?match=${match.matchId}`}
              className="match-history-row"
            >
              <Icon name={match.gameType === "snakes_and_ladders" ? "grid" : "play"} size={16} />
              <span className="match-history-when">
                <strong>
                  {match.gameType === "snakes_and_ladders" ? t("entrance.snakes") : t("entrance.ludo")} · {summary}
                </strong>
                <small>{when(match.endedAt, locale)}</small>
              </span>
              {match.endReason === "completed" && (
                <span className="match-history-place">{place(t, match.placement)}</span>
              )}
              <Icon name="replay" size={15} />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
