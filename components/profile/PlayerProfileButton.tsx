"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { getPlayerProfile, type PlayerProfile } from "@/lib/supabase/profile";
import { ProfileCard } from "@/components/profile/ProfileCard";
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
  const client = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setProfile(null);
      setError(null);
      try {
        const data = await getPlayerProfile(client, playerId);
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load this profile.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, client, playerId]);

  if (isBot) return <>{children}</>;

  return (
    <>
      <button
        type="button"
        className={`profile-open-trigger ${className}`}
        onClick={() => setOpen(true)}
        aria-label={`View ${displayName}'s profile`}
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
              aria-label={`${displayName}'s profile`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                className="profile-close"
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close profile"
              >
                ×
              </button>
              <span className="eyebrow">PLAYER PROFILE</span>
              {error ? (
                <p className="profile-message" role="alert">
                  {error}
                </p>
              ) : !profile ? (
                <p className="profile-message" role="status">
                  Loading…
                </p>
              ) : profile.visibility === "visible" ? (
                <ProfileCard profile={profile} />
              ) : profile.visibility === "hidden" ? (
                <p className="profile-message">
                  {profile.displayName ?? displayName} keeps their stats private.
                </p>
              ) : profile.visibility === "guest" ? (
                <p className="profile-message">
                  {displayName} is playing as a guest — no profile yet.
                </p>
              ) : (
                <p className="profile-message">No profile for this seat.</p>
              )}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
