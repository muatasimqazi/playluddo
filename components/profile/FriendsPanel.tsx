"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import {
  getFriends,
  getMyFriendCode,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  type Friend,
} from "@/lib/supabase/friends";

/**
 * The player's friends manager (docs/COMPETITIVE_ROADMAP.md F3.6): their
 * shareable friend code, a box to add by code, incoming requests to accept or
 * decline, and the friends list. A friend at a joinable table can be joined
 * from the home page's "play again" strip. Self-only (the /profile page).
 */
export function FriendsPanel() {
  const client = useMemo(() => createClient(), []);
  const [code, setCode] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [entry, setEntry] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      setFriends(await getFriends(client));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load your friends.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [c, f] = await Promise.all([getMyFriendCode(client), getFriends(client)]);
        if (!cancelled) {
          setCode(c);
          setFriends(f);
        }
      } catch (err) {
        if (!cancelled)
          setMessage(err instanceof Error ? err.message : "Could not load your friends.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function add() {
    const value = entry.trim().toUpperCase();
    if (!value) return;
    setPending("add");
    setMessage(null);
    try {
      await sendFriendRequest(client, value);
      setEntry("");
      setMessage("Request sent.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? friendlyError(err.message) : "Could not send that request.");
    } finally {
      setPending(null);
    }
  }

  async function act(friend: Friend, run: () => Promise<void>, key: string) {
    setPending(`${key}:${friend.userId}`);
    setMessage(null);
    try {
      await run();
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update that friend.");
    } finally {
      setPending(null);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage("Copy failed — your code is shown above.");
    }
  }

  const incoming = friends?.filter((f) => f.status === "pending" && f.direction === "incoming") ?? [];
  const outgoing = friends?.filter((f) => f.status === "pending" && f.direction === "outgoing") ?? [];
  const accepted = friends?.filter((f) => f.status === "accepted") ?? [];

  return (
    <section className="friends-panel">
      <span className="eyebrow">FRIENDS</span>

      <div className="friends-code">
        <div>
          <small>YOUR FRIEND CODE</small>
          <strong>{code ?? "…"}</strong>
        </div>
        <button type="button" onClick={() => void copyCode()} disabled={!code}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="friends-add">
        <input
          value={entry}
          onChange={(e) => setEntry(e.target.value.toUpperCase())}
          placeholder="Friend's code"
          maxLength={8}
          aria-label="Friend's code"
        />
        <button type="button" disabled={pending === "add" || !entry.trim()} onClick={() => void add()}>
          {pending === "add" ? "…" : "Add"}
        </button>
      </div>

      {incoming.length > 0 && (
        <div className="friends-group">
          <h3>Requests</h3>
          <ul>
            {incoming.map((f) => (
              <li key={f.userId}>
                <FriendIdentity friend={f} />
                <div className="friends-actions">
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void act(f, () => respondFriendRequest(client, f.userId, true), "accept")}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="is-quiet"
                    disabled={pending !== null}
                    onClick={() => void act(f, () => respondFriendRequest(client, f.userId, false), "decline")}
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="friends-group">
        <h3>{accepted.length > 0 ? `Friends · ${accepted.length}` : "Friends"}</h3>
        {friends && accepted.length === 0 && outgoing.length === 0 ? (
          <p className="friends-empty">Share your code, or add a player from their seat at a table.</p>
        ) : (
          <ul>
            {accepted.map((f) => (
              <li key={f.userId}>
                <FriendIdentity friend={f} />
                {f.activeRoom && <span className="friends-at-table">At a table</span>}
                <button
                  type="button"
                  className="is-quiet"
                  disabled={pending !== null}
                  onClick={() => void act(f, () => removeFriend(client, f.userId), "remove")}
                >
                  Remove
                </button>
              </li>
            ))}
            {outgoing.map((f) => (
              <li key={f.userId} className="is-pending">
                <FriendIdentity friend={f} />
                <span className="friends-pending">Requested</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {message && (
        <p className="friends-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function FriendIdentity({ friend }: { friend: Friend }) {
  return (
    <span className="friends-identity">
      <PlayerAvatar
        player={{ avatarId: friend.avatarId ?? undefined, color: "blue", displayName: friend.displayName, seatIndex: 0 }}
        size={32}
      />
      <span>
        <strong>{friend.displayName}</strong>
        <small>Level {friend.level}</small>
      </span>
    </span>
  );
}

function friendlyError(message: string) {
  if (message.includes("NO_SUCH_CODE")) return "No player has that code.";
  if (message.includes("BLOCKED")) return "You can't add this player.";
  if (message.includes("INVALID_FRIEND")) return "That's your own code.";
  return message;
}
