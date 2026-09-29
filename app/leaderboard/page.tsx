"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
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
import {
  gameCenterAvailable,
  showGameCenterAchievements,
  showGameCenterLeaderboard,
} from "@/lib/gameCenter";
import "@/components/simulator/simulator.css";

// Platform never changes while the page is open.
const noSubscription = () => () => {};

export default function LeaderboardPage() {
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
      setGameCenterNote("Sign in to Game Center in the Settings app to see your ranking and achievements.");
  }

  useEffect(() => {
    void ensureSession(client).then(() =>
      client.auth.getUser().then(({ data }) => setUser(data.user)),
    );
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
          setError(err instanceof Error ? err.message : "Could not load the leaderboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, user, scope]);

  const scopes = [{ id: "global", name: "Global" }, ...teams.map(({ id, name }) => ({ id, name }))];

  return (
    <main className="sim-entrance leaderboard-page">
      {/* Same backdrop as the entrance: the static apartment photo under the
          green shade, so the leaderboard reads as another room of the house. */}
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
        <span className="eyebrow">THE LEADERBOARD</span>
        <h1>
          Who&rsquo;s winning
          <br />
          the <em>most?</em>
        </h1>

        <div className="leaderboard-record">
          <Icon name="trophy" size={18} />
          {authenticated ? (
            <div>
              <span className="eyebrow">YOUR RECORD</span>
              <strong>
                {myWins ?? "…"} {myWins === 1 ? "win" : "wins"}
              </strong>
            </div>
          ) : (
            <div>
              <span className="eyebrow">NOT ON THE BOARD YET</span>
              <p>Sign in from your profile to start counting your wins.</p>
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
              Achievements
            </button>
          </div>
        )}
        {gameCenterNote && <p className="leaderboard-game-center-note">{gameCenterNote}</p>}

        {scopes.length > 1 && (
          <div className="leaderboard-scopes" role="tablist" aria-label="Leaderboard">
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
          <div className="leaderboard-scopes" role="tablist" aria-label="Team view">
            {(
              [
                ["All-time", null],
                ["This week", 0],
                ["Last week", 1],
              ] as const
            ).map(([label, weeks]) => (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={seasonWeeks === weeks}
                className={seasonWeeks === weeks ? "is-selected" : undefined}
                onClick={() => setSeasonWeeks(weeks)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {scope !== "global" && seasonWeeks !== null ? (
          <TeamSeasonPanel
            client={client}
            teamId={scope}
            teamName={teams.find((team) => team.id === scope)?.name ?? "Team"}
            weeksAgo={seasonWeeks}
            myUserId={user?.id ?? null}
          />
        ) : error ? (
          <p role="alert" className="leaderboard-message is-error">
            {error}
          </p>
        ) : loading ? (
          <div className="leaderboard-loading" aria-label="Loading the leaderboard">
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
                ? "No wins on the board yet — play a match to be the first."
                : "No one on this team has a win yet."
            }
          />
        )}
      </section>
    </main>
  );
}
