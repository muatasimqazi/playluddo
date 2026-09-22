import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import type { LeaderboardEntry } from "@/lib/supabase/leaderboard";

export function LeaderboardPanel({
  entries,
  myUserId,
  emptyMessage,
}: {
  entries: LeaderboardEntry[];
  myUserId: string | null;
  emptyMessage: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-hairline bg-surface p-4 text-center text-body-sm text-text-secondary shadow-elevation-1">
        {emptyMessage}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3 shadow-elevation-1">
      {entries.map((entry) => (
        <div key={entry.userId} className="flex items-center gap-3">
          <span className="w-5 text-body-sm font-semibold text-text-secondary">
            {entry.rank}
          </span>
          <PlayerAvatar
            player={{
              displayName: entry.displayName,
              avatarId: entry.avatarId ?? undefined,
              color: "blue",
              seatIndex: 0,
            }}
            size={32}
            placement={entry.rank <= 3 ? (entry.rank as 1 | 2 | 3) : undefined}
          />
          <span className="flex-1 truncate text-body-sm text-foreground">
            {entry.displayName} {entry.userId === myUserId && "(You)"}
          </span>
          <span className="text-label-sm text-text-secondary">
            {entry.wins} {entry.wins === 1 ? "win" : "wins"}
          </span>
        </div>
      ))}
    </div>
  );
}
