"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { track } from "@/lib/analytics";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { PlayerProfileButton } from "@/components/profile/PlayerProfileButton";
import {
  addRecentPlayerFriend,
  getFriends,
  getRecentPlayers,
  type Friend,
  type RecentPlayer,
} from "@/lib/supabase/friends";

interface Entry {
  userId: string;
  displayName: string;
  avatarId: string | null;
  level: number;
  roomCode: string | null;
  isFriend: boolean;
}

/**
 * Home-page "play again with these people" (docs/COMPETITIVE_ROADMAP.md F3.7),
 * plus friends currently at a joinable table (F3.6): join in one tap, or add a
 * recent player as a friend. Renders nothing for guests or when empty.
 */
export function PlayAgain({ onJoin }: { onJoin: (roomCode: string) => void }) {
  const { t } = useI18n();
  const client = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [added, setAdded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [friends, recent] = await Promise.all([
          getFriends(client).catch(() => [] as Friend[]),
          getRecentPlayers(client).catch(() => [] as RecentPlayer[]),
        ]);
        if (cancelled) return;
        // Friends at a joinable table first, then recent players, de-duplicated.
        const seen = new Set<string>();
        const list: Entry[] = [];
        for (const f of friends) {
          if (f.status === "accepted" && f.activeRoom && !seen.has(f.userId)) {
            seen.add(f.userId);
            list.push({
              userId: f.userId,
              displayName: f.displayName,
              avatarId: f.avatarId,
              level: f.level,
              roomCode: f.activeRoom.code,
              isFriend: true,
            });
          }
        }
        for (const p of recent) {
          if (seen.has(p.userId)) continue;
          seen.add(p.userId);
          list.push({
            userId: p.userId,
            displayName: p.displayName,
            avatarId: p.avatarId,
            level: p.level,
            roomCode: p.activeRoom?.code ?? null,
            isFriend: p.isFriend,
          });
        }
        setEntries(list.slice(0, 6));
      } catch {
        // Guests and errors simply show nothing here.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function add(userId: string) {
    try {
      await addRecentPlayerFriend(client, userId);
      track("friend_request_sent", { method: "recent_table" });
      setAdded((prev) => ({ ...prev, [userId]: true }));
    } catch {
      // Non-fatal: the manager on the profile page can retry.
    }
  }

  if (entries.length === 0) return null;

  return (
    <section className="play-again" aria-label={t("lobby.playAgainLabel")}>
      <span className="eyebrow">{t("lobby.playAgainLabel").toUpperCase()}</span>
      <ul>
        {entries.map((e) => (
          <li key={e.userId}>
            <PlayerProfileButton
              userId={e.userId}
              displayName={e.displayName}
            >
              <PlayerAvatar
                player={{ avatarId: e.avatarId ?? undefined, color: "blue", displayName: e.displayName, seatIndex: 0 }}
                size={34}
                level={e.level}
              />
            </PlayerProfileButton>
            <span className="play-again-name">{e.displayName}</span>
            {e.roomCode ? (
              <button
                type="button"
                onClick={() => {
                  track("play_again_used", { is_friend: !!e.isFriend });
                  onJoin(e.roomCode!);
                }}
              >
                {t("actions.join")}
              </button>
            ) : e.isFriend ? (
              <span className="play-again-friend">{t("lobby.friend")}</span>
            ) : (
              <button
                type="button"
                className="is-quiet"
                disabled={!!added[e.userId]}
                onClick={() => void add(e.userId)}
              >
                {added[e.userId] ? t("lobby.added") : t("lobby.addFriend")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
