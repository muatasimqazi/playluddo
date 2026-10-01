"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { getAccountProfile, getMyProfile, getPlayerProfile, type PlayerProfile } from "@/lib/supabase/profile";
import { addFriendFromSeat } from "@/lib/supabase/friends";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { useI18n } from "@/lib/i18n";
import "@/components/simulator/simulator.css";

/** Which player: a seat (players.id) or an account the list already knows. */
export type ProfileTarget =
  | { playerId: string; userId?: never }
  | { userId: string; playerId?: never };

/**
 * Wraps a player's avatar or name so tapping it opens their profile
 * (docs/COMPETITIVE_ROADMAP.md F3.1) — anywhere they show up. A seat passes
 * `playerId` (players.id); a list that already knows the account (leaderboard,
 * friends, recently played) passes `userId`. Bots, empty seats and `disabled`
 * (practice, shared-device and TV tables) aren't clickable — the children
 * render as-is.
 */
export function PlayerProfileButton({
  playerId,
  userId,
  displayName,
  isBot = false,
  disabled = false,
  className = "",
  children,
}: {
  displayName: string;
  isBot?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
} & ProfileTarget) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (isBot || disabled) return <>{children}</>;

  return (
    <>
      <button
        type="button"
        className={`profile-open-trigger ${className}`}
        onClick={() => setOpen(true)}
        aria-label={t("profile.viewProfileAria", { name: displayName })}
      >
        {children}
      </button>
      {open && (
        <PlayerProfileDialog
          {...(playerId ? { playerId } : { userId: userId! })}
          displayName={displayName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The profile modal itself, for callers that can't wrap a trigger — the 3D
 * table's seat labels live in drei's own React root, outside the i18n
 * provider, so the table opens this from its callback instead. The profile is
 * fetched on mount and respects the player's privacy setting server-side.
 */
export function PlayerProfileDialog({
  playerId,
  userId,
  displayName,
  onClose,
}: {
  displayName: string;
  onClose: () => void;
  // `self`: the signed-in player's own profile, seat or no seat (the table
  // menu's "My profile", in practice too).
} & (ProfileTarget | { self: true; playerId?: never; userId?: never })) {
  const { t } = useI18n();
  const client = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `self` with no account yet: signed out (practice runs sessionless) or a guest.
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [friendState, setFriendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function addFriend() {
    if (!playerId) return;
    setFriendState("sending");
    try {
      await addFriendFromSeat(client, playerId);
      setFriendState("sent");
    } catch {
      setFriendState("failed");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setProfile(null);
      setError(null);
      setFriendState("idle");
      try {
        if (!playerId && !userId) {
          const {
            data: { session },
          } = await client.auth.getSession();
          if (!session || session.user.is_anonymous) {
            if (!cancelled) setNeedsSignIn(true);
            return;
          }
        }
        const data = playerId
          ? await getPlayerProfile(client, playerId)
          : userId
            ? await getAccountProfile(client, userId)
            : await getMyProfile(client);
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t("profile.loadOneError"));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // `t` only feeds the catch fallback; excluding it avoids a locale-change refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, playerId, userId]);

  return createPortal(
    <div className="profile-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="profile-panel profile-view-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("profile.profileAria", { name: displayName })}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="profile-close"
          type="button"
          onClick={onClose}
          aria-label={t("account.closeProfile")}
        >
          ×
        </button>
        <span className="eyebrow">{t("profile.playerProfile").toUpperCase()}</span>
        {needsSignIn ? (
          <p className="profile-message">{t("profile.noProfileBody")}</p>
        ) : error ? (
          <p className="profile-message" role="alert">
            {error}
          </p>
        ) : !profile ? (
          <p className="profile-message" role="status">
            {t("actions.loading")}
          </p>
        ) : profile.visibility === "visible" ? (
          <ProfileCard profile={profile} />
        ) : profile.visibility === "hidden" ? (
          <p className="profile-message">
            {t("profile.keepsPrivate", { name: profile.displayName ?? displayName })}
          </p>
        ) : profile.visibility === "guest" ? (
          <p className="profile-message">
            {t("profile.guestNoProfile", { name: displayName })}
          </p>
        ) : (
          <p className="profile-message">{t("profile.noProfileSeat")}</p>
        )}
        {/* Seat-only: an account id can't be used to send arbitrary requests
            (add_recent_player_friend is bounded the same way). */}
        {playerId &&
          profile &&
          ((profile.visibility === "visible" && !profile.isSelf) ||
            profile.visibility === "hidden") && (
            <button
              type="button"
              className="profile-add-friend"
              disabled={friendState === "sending" || friendState === "sent"}
              onClick={() => void addFriend()}
            >
              {friendState === "sent"
                ? t("profile.friendRequestSent")
                : friendState === "sending"
                  ? t("profile.sending")
                  : friendState === "failed"
                    ? t("profile.addFailed")
                    : t("lobby.addFriend")}
            </button>
          )}
      </section>
    </div>,
    document.body,
  );
}
