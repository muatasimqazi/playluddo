"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Icon } from "@/components/simulator/Icon";

export default function LeaderboardPage() {
  const client = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scope, setScope] = useState<"global" | string>("global");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myWins, setMyWins] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authenticated = !!user && !user.is_anonymous;

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

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-hairline bg-surface text-foreground shadow-elevation-1"
          aria-label="Back to home"
        >
          <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
        </Link>
        <div>
          <p className="flex items-center gap-1 text-label-lg text-action">
            <Icon name="trophy" size={16} /> Leaderboard
          </p>
          <h1 className="text-headline-md tracking-tight text-foreground">
            Who&rsquo;s winning the most?
          </h1>
        </div>
      </div>

      {authenticated ? (
        <p className="rounded-lg border border-hairline bg-surface p-3 text-body-sm text-foreground shadow-elevation-1">
          You&rsquo;ve won <strong>{myWins ?? "…"}</strong>{" "}
          {myWins === 1 ? "match" : "matches"}.
        </p>
      ) : (
        <p className="rounded-lg border border-hairline bg-surface p-3 text-body-sm text-text-secondary shadow-elevation-1">
          Sign in from your profile to start appearing on the leaderboard.
        </p>
      )}

      {teams.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setScope("global")}
            className={`shrink-0 rounded-full border border-hairline px-3 py-1.5 text-label-sm ${
              scope === "global" ? "bg-action text-white" : "bg-surface text-foreground"
            }`}
          >
            Global
          </button>
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setScope(team.id)}
              className={`shrink-0 rounded-full border border-hairline px-3 py-1.5 text-label-sm ${
                scope === team.id ? "bg-action text-white" : "bg-surface text-foreground"
              }`}
            >
              {team.name}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-center text-body-sm text-quadrant-red">
          {error}
        </p>
      ) : loading ? (
        <p className="text-center text-body-sm text-text-secondary">Loading…</p>
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
    </div>
  );
}
