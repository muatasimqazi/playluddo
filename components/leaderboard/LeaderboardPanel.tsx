"use client";

import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import type { LeaderboardEntry } from "@/lib/supabase/leaderboard";
import { useI18n } from "@/lib/i18n";

// Podium order left to right: 2nd, 1st (raised), 3rd.
const PODIUM_ORDER = [1, 0, 2];

/**
 * The top three stand on a podium (crown and laurels from PlayerAvatar's
 * placement badges); everyone after them is a row below. The signed-in
 * player's own entry is outlined in gold wherever it lands.
 */
export function LeaderboardPanel({
  entries,
  myUserId,
  emptyMessage,
}: {
  entries: LeaderboardEntry[];
  myUserId: string | null;
  emptyMessage: string;
}) {
  const { t } = useI18n();
  if (entries.length === 0) {
    return <p className="leaderboard-message">{emptyMessage}</p>;
  }
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  return (
    <div className="leaderboard-board">
      <ol className="leaderboard-podium">
        {PODIUM_ORDER.filter((i) => podium[i]).map((i) => {
          const entry = podium[i];
          const place = entry.rank as 1 | 2 | 3;
          return (
            <li
              key={entry.userId}
              className={`is-place-${place} ${entry.userId === myUserId ? "is-me" : ""}`}
            >
              <PlayerAvatar
                player={{
                  displayName: entry.displayName,
                  avatarId: entry.avatarId ?? undefined,
                  color: "blue",
                  seatIndex: entry.rank,
                }}
                size={place === 1 ? 64 : 50}
                placement={place <= 3 ? place : undefined}
              />
              <strong>{entry.displayName}</strong>
              <span>
                {t(entry.wins === 1 ? "leaderboard.winOne" : "leaderboard.winOther", { count: entry.wins })}
                {entry.userId === myUserId && (
                  <small className="leaderboard-you">{t("leaderboard.you").toUpperCase()}</small>
                )}
              </span>
              <i aria-hidden>{entry.rank}</i>
            </li>
          );
        })}
      </ol>
      {rest.length > 0 && (
        <ol className="leaderboard-list" start={4}>
          {rest.map((entry) => (
            <li key={entry.userId} className={entry.userId === myUserId ? "is-me" : undefined}>
              <span className="leaderboard-rank">{entry.rank}</span>
              <PlayerAvatar
                player={{
                  displayName: entry.displayName,
                  avatarId: entry.avatarId ?? undefined,
                  color: "blue",
                  seatIndex: entry.rank,
                }}
                size={30}
              />
              <strong>{entry.displayName}</strong>
              {entry.userId === myUserId && (
                <small className="leaderboard-you">{t("leaderboard.you").toUpperCase()}</small>
              )}
              <span className="leaderboard-wins">
                {t(entry.wins === 1 ? "leaderboard.winOne" : "leaderboard.winOther", { count: entry.wins })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
