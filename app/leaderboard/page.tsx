"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ProfilePanel } from "@/components/auth/ProfilePanel";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import {
  getGlobalLeaderboard,
  getMyWins,
  getTeamLeaderboard,
  type LeaderboardEntry,
} from "@/lib/supabase/leaderboard";
import { getMyTeams, type Team } from "@/lib/supabase/teams";
import { LeaderboardPanel } from "@/components/leaderboard/LeaderboardPanel";
import { TeamSeasonPanel } from "@/components/leaderboard/TeamSeasonPanel";
import { Icon } from "@/components/simulator/Icon";
import { ProfileHeaderLink } from "@/components/profile/ProfileHeaderLink";
import {
  gameCenterAvailable,
  showGameCenterAchievements,
  showGameCenterLeaderboard,
} from "@/lib/gameCenter";
import { useI18n } from "@/lib/i18n";
import "@/components/simulator/simulator.css";

// Platform never changes while the page is open.
const noSubscription = () => () => {};

/** These pages show no name from the profile panel; it only signs players in here. */
const ignoreName = () => {};

export default function LeaderboardPage() {
  const { t } = useI18n();
  const client = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scope, setScope] = useState<"global" | string>("global");
  // For a team scope: null = all-time wins, 0 = this week's season, 1 = last week.
  const [seasonWeeks, setSeasonWeeks] = useState<number | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myWins, setMyWins] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authenticated = !!user && !user.is_anonymous;
  // Only in the iOS app; false while prerendering so hydration matches.
  const gameCenter = useSyncExternalStore(noSubscription, gameCenterAvailable, () => false);
  const [gameCenterNote, setGameCenterNote] = useState<string | null>(null);
  async function openGameCenter(show: () => Promise<boolean>) {
    setGameCenterNote(null);
    // false = the player isn't signed in to Game Center on this device.
    if (!(await show()))
      setGameCenterNote(t("leaderboard.gameCenterNote"));
  }

  useEffect(() => {
    void ensureSession(client).then(() =>
      client.auth.getUser().then(({ data }) => setUser(data.user)),
    );
    // Signing in from the header's profile panel updates the page in place.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (session) setUser(session.user);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!authenticated) return;
    void getMyTeams(client).catch(() => []).then((value) => setTeams(value ?? []));
    void getMyWins(client).catch(() => null).then(setMyWins);
  }, [client, authenticated]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data =
          scope === "global"
            ? await getGlobalLeaderboard(client)
            : await getTeamLeaderboard(client, scope);
        if (!cancelled) setEntries(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t("leaderboard.loadError"));
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
  }, [client, user, scope]);

  const scopes = [{ id: "global", name: t("leaderboard.global") }, ...teams.map(({ id, name }) => ({ id, name }))];

  return (
    <main className="sim-entrance leaderboard-page">
      {/* Same backdrop as the entrance: the static apartment photo under the
          green shade, so the leaderboard reads as another room of the house. */}
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
        <div className="entrance-header-actions">
          <ProfileHeaderLink />
          {/* Signed out: sign in right here, and come back to this page. */}
          {user && !authenticated && <ProfilePanel onNameChange={ignoreName} />}
          <Link href="/" className="profile-trigger leaderboard-back">
            <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
            <small>{t("actions.backHome")}</small>
          </Link>
        </div>
      </header>

      <section className="leaderboard-content">
        <span className="eyebrow">{t("leaderboard.eyebrow").toUpperCase()}</span>
        <h1>
          {t("leaderboard.title1")}
          <br />
          {t("leaderboard.titleLead")} <em>{t("leaderboard.titleEm")}</em>
        </h1>

        <div className="leaderboard-record">
          <Icon name="trophy" size={18} />
          {authenticated ? (
            <div>
              <span className="eyebrow">{t("leaderboard.yourRecord").toUpperCase()}</span>
              <strong>
                {myWins === null
                  ? "…"
                  : t(myWins === 1 ? "leaderboard.winOne" : "leaderboard.winOther", { count: myWins })}
              </strong>
            </div>
          ) : (
            <div>
              <span className="eyebrow">{t("leaderboard.notOnBoard").toUpperCase()}</span>
              <p>{t("leaderboard.signInToCount")}</p>
            </div>
          )}
        </div>

        {gameCenter && (
          <div className="leaderboard-game-center">
            <button type="button" onClick={() => void openGameCenter(showGameCenterLeaderboard)}>
              <Icon name="trophy" size={15} />
              Game Center
            </button>
            <button type="button" onClick={() => void openGameCenter(showGameCenterAchievements)}>
              <Icon name="check" size={15} />
              {t("leaderboard.achievements")}
            </button>
          </div>
        )}
        {gameCenterNote && <p className="leaderboard-game-center-note">{gameCenterNote}</p>}

        {scopes.length > 1 && (
          <div className="leaderboard-scopes" role="tablist" aria-label={t("leaderboard.scopeAria")}>
            {scopes.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={scope === option.id}
                className={scope === option.id ? "is-selected" : undefined}
                onClick={() => {
                  setScope(option.id);
                  setSeasonWeeks(null);
                }}
              >
                {option.name}
              </button>
            ))}
          </div>
        )}

        {scope !== "global" && (
          <div className="leaderboard-scopes" role="tablist" aria-label={t("leaderboard.teamViewAria")}>
            {(
              [
                ["leaderboard.allTime", null],
                ["leaderboard.thisWeek", 0],
                ["leaderboard.lastWeek", 1],
              ] as const
            ).map(([labelKey, weeks]) => (
              <button
                key={labelKey}
                type="button"
                role="tab"
                aria-selected={seasonWeeks === weeks}
                className={seasonWeeks === weeks ? "is-selected" : undefined}
                onClick={() => setSeasonWeeks(weeks)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        )}

        {scope !== "global" && seasonWeeks !== null ? (
          <TeamSeasonPanel
            client={client}
            teamId={scope}
            teamName={teams.find((team) => team.id === scope)?.name ?? t("leaderboard.teamFallback")}
            weeksAgo={seasonWeeks}
            myUserId={user?.id ?? null}
          />
        ) : error ? (
          <p role="alert" className="leaderboard-message is-error">
            {error}
          </p>
        ) : loading ? (
          <div className="leaderboard-loading" aria-label={t("leaderboard.loading")}>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        ) : (
          <LeaderboardPanel
            entries={entries}
            myUserId={user?.id ?? null}
            emptyMessage={
              scope === "global"
                ? t("leaderboard.emptyGlobal")
                : t("leaderboard.emptyTeam")
            }
          />
        )}
      </section>
    </main>
  );
}
