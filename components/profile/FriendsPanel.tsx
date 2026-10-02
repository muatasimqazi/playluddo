"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { PlayerProfileButton } from "@/components/profile/PlayerProfileButton";
import { useI18n, type Translator } from "@/lib/i18n";
import {
  getFriends,
  getMyFriendCode,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  type Friend,
} from "@/lib/supabase/friends";
import { track } from "@/lib/analytics";

/**
 * The player's friends manager (docs/COMPETITIVE_ROADMAP.md F3.6): their
 * shareable friend code, a box to add by code, incoming requests to accept or
 * decline, and the friends list. A friend at a joinable table can be joined
 * from the home page's "play again" strip. Self-only (the /profile page).
 */
export function FriendsPanel() {
  const { t } = useI18n();
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
      setMessage(err instanceof Error ? err.message : t("profile.friendsLoadError"));
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
          setMessage(err instanceof Error ? err.message : t("profile.friendsLoadError"));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // `t` only feeds the catch fallback; excluding it avoids a locale-change reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  async function add() {
    const value = entry.trim().toUpperCase();
    if (!value) return;
    setPending("add");
    setMessage(null);
    try {
      await sendFriendRequest(client, value);
      track("friend_request_sent", { method: "code" });
      setEntry("");
      setMessage(t("profile.requestSent"));
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? friendlyError(t, err.message) : t("profile.couldNotSend"));
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
      setMessage(err instanceof Error ? err.message : t("profile.couldNotUpdate"));
    } finally {
      setPending(null);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      track("share", { method: "copy", content_type: "friend_code" });
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage(t("profile.copyFailed"));
    }
  }

  const incoming = friends?.filter((f) => f.status === "pending" && f.direction === "incoming") ?? [];
  const outgoing = friends?.filter((f) => f.status === "pending" && f.direction === "outgoing") ?? [];
  const accepted = friends?.filter((f) => f.status === "accepted") ?? [];

  return (
    <section className="friends-panel">
      <span className="eyebrow">{t("profile.friends").toUpperCase()}</span>

      <div className="friends-code">
        <div>
          <small>{t("profile.yourFriendCode").toUpperCase()}</small>
          <strong>{code ?? "…"}</strong>
        </div>
        <button type="button" onClick={() => void copyCode()} disabled={!code}>
          {copied ? t("profile.copied") : t("profile.copy")}
        </button>
      </div>

      <div className="friends-add">
        <input
          value={entry}
          onChange={(e) => setEntry(e.target.value.toUpperCase())}
          placeholder={t("profile.friendCodePlaceholder")}
          maxLength={8}
          aria-label={t("profile.friendCodePlaceholder")}
        />
        <button type="button" disabled={pending === "add" || !entry.trim()} onClick={() => void add()}>
          {pending === "add" ? "…" : t("profile.add")}
        </button>
      </div>

      {incoming.length > 0 && (
        <div className="friends-group">
          <h3>{t("profile.requests")}</h3>
          <ul>
            {incoming.map((f) => (
              <li key={f.userId}>
                <FriendIdentity friend={f} />
                <div className="friends-actions">
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() =>
                      void act(
                        f,
                        async () => {
                          await respondFriendRequest(client, f.userId, true);
                          track("friend_request_accepted", {});
                        },
                        "accept",
                      )
                    }
                  >
                    {t("profile.accept")}
                  </button>
                  <button
                    type="button"
                    className="is-quiet"
                    disabled={pending !== null}
                    onClick={() => void act(f, () => respondFriendRequest(client, f.userId, false), "decline")}
                  >
                    {t("profile.decline")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="friends-group">
        <h3>
          {accepted.length > 0
            ? t("profile.friendsWithCount", { count: accepted.length })
            : t("profile.friends")}
        </h3>
        {friends && accepted.length === 0 && outgoing.length === 0 ? (
          <p className="friends-empty">{t("profile.emptyFriends")}</p>
        ) : (
          <ul>
            {accepted.map((f) => (
              <li key={f.userId}>
                <FriendIdentity friend={f} />
                {f.activeRoom && <span className="friends-at-table">{t("profile.atATable")}</span>}
                <button
                  type="button"
                  className="is-quiet"
                  disabled={pending !== null}
                  onClick={() => void act(f, () => removeFriend(client, f.userId), "remove")}
                >
                  {t("profile.remove")}
                </button>
              </li>
            ))}
            {outgoing.map((f) => (
              <li key={f.userId} className="is-pending">
                <FriendIdentity friend={f} />
                <span className="friends-pending">{t("profile.requested")}</span>
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
  const { t } = useI18n();
  return (
    <span className="friends-identity">
      <PlayerProfileButton
        userId={friend.userId}
        displayName={friend.displayName}
      >
        <PlayerAvatar
          player={{ avatarId: friend.avatarId ?? undefined, color: "blue", displayName: friend.displayName, seatIndex: 0 }}
          size={32}
        />
      </PlayerProfileButton>
      <span>
        <strong>{friend.displayName}</strong>
        <small>{t("profile.friendLevel", { level: friend.level })}</small>
      </span>
    </span>
  );
}

function friendlyError(t: Translator, message: string) {
  if (message.includes("NO_SUCH_CODE")) return t("profile.errNoSuchCode");
  if (message.includes("BLOCKED")) return t("profile.errBlocked");
  if (message.includes("INVALID_FRIEND")) return t("profile.errInvalidFriend");
  return message;
}
