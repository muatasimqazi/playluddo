"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { getMyProfile, type PlayerProfile } from "@/lib/supabase/profile";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { CosmeticsLocker } from "@/components/profile/CosmeticsLocker";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

export default function ProfilePage() {
  const client = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authenticated = !!user && !user.is_anonymous;

  useEffect(() => {
    void ensureSession(client).then(() =>
      client.auth.getUser().then(({ data }) => setUser(data.user)),
    );
  }, [client]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      if (!authenticated) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await getMyProfile(client);
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load your profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, user, authenticated]);

  return (
    <main className="sim-entrance leaderboard-page">
      {/* Same backdrop as the entrance and leaderboard: another room of the house. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand" aria-label="Back to the apartment">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            LUDDO<small>HOUSE</small>
          </span>
        </Link>
        <Link href="/" className="profile-trigger leaderboard-back">
          <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
          <small>Back to the apartment</small>
        </Link>
      </header>

      <section className="leaderboard-content">
        <span className="eyebrow">YOUR RECORD</span>
        <h1>
          Your <em>profile</em>
        </h1>

        {error ? (
          <p role="alert" className="leaderboard-message is-error">
            {error}
          </p>
        ) : loading ? (
          <div className="leaderboard-loading" aria-label="Loading your profile">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        ) : !authenticated ? (
          <div className="leaderboard-record">
            <Icon name="users" size={18} />
            <div>
              <span className="eyebrow">NO PROFILE YET</span>
              <p>Sign in from your profile on the home page to start tracking your stats.</p>
            </div>
          </div>
        ) : profile && profile.visibility === "visible" ? (
          <>
            <ProfileCard profile={profile} />
            <CosmeticsLocker />
          </>
        ) : (
          <p className="leaderboard-message">Play a match to start your profile.</p>
        )}
      </section>
    </main>
  );
}
