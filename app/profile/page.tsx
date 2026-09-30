"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { getMyProfile, type PlayerProfile } from "@/lib/supabase/profile";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { CosmeticsLocker } from "@/components/profile/CosmeticsLocker";
import { FriendsPanel } from "@/components/profile/FriendsPanel";
import { MatchHistory } from "@/components/profile/MatchHistory";
import { Icon } from "@/components/simulator/Icon";
import { useI18n } from "@/lib/i18n";
import "@/components/simulator/simulator.css";

export default function ProfilePage() {
  const { t } = useI18n();
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
          setError(err instanceof Error ? err.message : t("profile.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // `t` only feeds the catch fallback; excluding it avoids a locale-change refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, user, authenticated]);

  return (
    <main className="sim-entrance leaderboard-page">
      {/* Same backdrop as the entrance and leaderboard: another room of the house. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand" aria-label={t("actions.homeLabel")}>
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
          <small>{t("actions.backHome")}</small>
        </Link>
      </header>

      <section className="leaderboard-content">
        <span className="eyebrow">{t("profile.eyebrow").toUpperCase()}</span>
        <h1>
          {t("profile.titlePre")}
          <em>{t("profile.titleEm")}</em>
        </h1>

        {error ? (
          <p role="alert" className="leaderboard-message is-error">
            {error}
          </p>
        ) : loading ? (
          <div className="leaderboard-loading" aria-label={t("profile.loading")}>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        ) : !authenticated ? (
          <div className="leaderboard-record">
            <Icon name="users" size={18} />
            <div>
              <span className="eyebrow">{t("profile.noProfileEyebrow").toUpperCase()}</span>
              <p>{t("profile.noProfileBody")}</p>
            </div>
          </div>
        ) : profile && profile.visibility === "visible" ? (
          <>
            <ProfileCard profile={profile} />
            <MatchHistory />
            <FriendsPanel />
            <CosmeticsLocker />
          </>
        ) : (
          <p className="leaderboard-message">{t("profile.playToStart")}</p>
        )}
      </section>
    </main>
  );
}
