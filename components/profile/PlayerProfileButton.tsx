"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { getPlayerProfile, type PlayerProfile } from "@/lib/supabase/profile";
import { addFriendFromSeat } from "@/lib/supabase/friends";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { useI18n } from "@/lib/i18n";
import "@/components/simulator/simulator.css";

/**
 * Wraps a seat's avatar so tapping it opens that player's profile
 * (docs/COMPETITIVE_ROADMAP.md F3.1). Bots and empty seats aren't clickable —
 * the children render as-is. The profile is fetched on open and respects the
 * player's privacy setting server-side.
 */
export function PlayerProfileButton({
  playerId,
  displayName,
  isBot,
  className = "",
  children,
}: {
  playerId: string;
  displayName: string;
  isBot: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const client = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friendState, setFriendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function addFriend() {
    setFriendState("sending");
    try {
      await addFriendFromSeat(client, playerId);
      setFriendState("sent");
    } catch {
      setFriendState("failed");
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setProfile(null);
      setError(null);
      setFriendState("idle");
      try {
        const data = await getPlayerProfile(client, playerId);
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
  }, [open, client, playerId]);

  if (isBot) return <>{children}</>;

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
      {open &&
        createPortal(
          <div
            className="profile-backdrop"
            role="presentation"
            onMouseDown={() => setOpen(false)}
          >
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
                onClick={() => setOpen(false)}
                aria-label={t("account.closeProfile")}
              >
                ×
              </button>
              <span className="eyebrow">{t("profile.playerProfile").toUpperCase()}</span>
              {error ? (
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
              {profile &&
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
        )}
    </>
  );
}
