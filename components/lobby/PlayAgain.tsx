"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
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
export function PlayAgain({
  name,
  onJoin,
}: {
  name: string;
  onJoin: (roomCode: string) => void;
}) {
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
      setAdded((prev) => ({ ...prev, [userId]: true }));
    } catch {
      // Non-fatal: the manager on the profile page can retry.
    }
  }

  if (entries.length === 0) return null;

  return (
    <section className="play-again" aria-label="Play again">
      <span className="eyebrow">PLAY AGAIN</span>
      <ul>
        {entries.map((e) => (
          <li key={e.userId}>
            <PlayerAvatar
              player={{ avatarId: e.avatarId ?? undefined, color: "blue", displayName: e.displayName, seatIndex: 0 }}
              size={34}
              level={e.level}
            />
            <span className="play-again-name">{e.displayName}</span>
            {e.roomCode ? (
              <button type="button" disabled={!name.trim()} onClick={() => onJoin(e.roomCode!)}>
                Join
              </button>
            ) : e.isFriend ? (
              <span className="play-again-friend">Friend</span>
            ) : (
              <button
                type="button"
                className="is-quiet"
                disabled={!!added[e.userId]}
                onClick={() => void add(e.userId)}
              >
                {added[e.userId] ? "Added" : "Add friend"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
