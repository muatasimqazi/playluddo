"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import type { GameType } from "@/lib/board/types";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { getMyTeams, type Team } from "@/lib/supabase/teams";
import {
  createTournament,
  getMyTournaments,
  joinTournament,
  type TournamentSummary,
} from "@/lib/supabase/tournaments";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// A local datetime-input value (YYYY-MM-DDTHH:mm), rounded to the next hour.
function defaultLocal(offsetHours: number): string {
  const d = new Date(Date.now() + offsetHours * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TournamentsPage() {
  const client = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);

  const authenticated = !!user && !user.is_anonymous;

  useEffect(() => {
    void ensureSession(client).then(() =>
      client.auth.getUser().then(({ data }) => setUser(data.user)),
    );
  }, [client]);

  async function refresh() {
    setTournaments(await getMyTournaments(client).catch(() => []));
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      if (!authenticated) {
        setLoading(false);
        return;
      }
      try {
        const [t, list] = await Promise.all([
          getMyTeams(client).catch(() => []),
          getMyTournaments(client).catch(() => []),
        ]);
        if (!cancelled) {
          setTeams(t ?? []);
          setTournaments(list ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load tournaments.");
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
        <span className="eyebrow">TEAM TOURNAMENTS</span>
        <h1>
          Play for the <em>trophy</em>
        </h1>

        {error && (
          <p role="alert" className="leaderboard-message is-error">
            {error}
          </p>
        )}

        {loading ? (
          <div className="leaderboard-loading" aria-label="Loading tournaments">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        ) : !authenticated ? (
          <p className="leaderboard-message">Sign in from your profile to run team tournaments.</p>
        ) : teams.length === 0 ? (
          <p className="leaderboard-message">
            Tournaments are for teams. Create a team from your profile, then come back.
          </p>
        ) : (
          <>
            {tournaments.length === 0 ? (
              <p className="leaderboard-message">No tournaments yet. Schedule the first one below.</p>
            ) : (
              <div className="tourney-list">
                {tournaments.map((t) => (
                  <div key={t.id} className="tourney-row">
                    <div className="tourney-row-main">
                      <strong>{t.name}</strong>
                      <small>
                        {t.teamName} · {t.size} players ·{" "}
                        {t.status === "active" ? "Live now" : whenLabel(t.startsAt)}
                      </small>
                    </div>
                    <span className={`tourney-badge is-${t.status}`}>
                      {t.status === "active" ? "LIVE" : `${t.entrantCount}/${t.size}`}
                    </span>
                    {t.status === "scheduled" && !t.entered ? (
                      <button
                        type="button"
                        className="panel-secondary"
                        disabled={pending || t.entrantCount >= t.size}
                        onClick={async () => {
                          setPending(true);
                          try {
                            await joinTournament(client, t.id);
                            await refresh();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Could not join.");
                          } finally {
                            setPending(false);
                          }
                        }}
                      >
                        Join
                      </button>
                    ) : (
                      <Link href={`/tournaments/${t.id}`} className="panel-secondary">
                        {t.status === "active" ? "Open bracket" : "View"}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}

            {creating ? (
              <CreateForm
                teams={teams}
                pending={pending}
                onCancel={() => setCreating(false)}
                onCreate={async (values) => {
                  setPending(true);
                  setError(null);
                  try {
                    await createTournament(client, values);
                    setCreating(false);
                    await refresh();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not create the tournament.");
                  } finally {
                    setPending(false);
                  }
                }}
              />
            ) : (
              <button type="button" className="sim-primary" onClick={() => setCreating(true)}>
                <Icon name="trophy" size={16} />
                Schedule a tournament
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function CreateForm({
  teams,
  pending,
  onCreate,
  onCancel,
}: {
  teams: Team[];
  pending: boolean;
  onCreate: (values: {
    teamId: string;
    name: string;
    size: 8 | 16;
    gameType: GameType;
    checkInOpensAt: string;
    startsAt: string;
  }) => void;
  onCancel: () => void;
}) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [name, setName] = useState("");
  const [size, setSize] = useState<8 | 16>(8);
  const [gameType, setGameType] = useState<GameType>("ludo");
  const [checkIn, setCheckIn] = useState(defaultLocal(0.5));
  const [start, setStart] = useState(defaultLocal(1));

  return (
    <form
      className="tourney-form"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({
          teamId,
          name: name.trim(),
          size,
          gameType,
          // datetime-local is local time; toISOString sends UTC.
          checkInOpensAt: new Date(checkIn).toISOString(),
          startsAt: new Date(start).toISOString(),
        });
      }}
    >
      <label>
        <span>Team</span>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Name</span>
        <input value={name} maxLength={40} required minLength={2} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="tourney-choices">
        <legend>Players</legend>
        {([8, 16] as const).map((n) => (
          <button key={n} type="button" className={size === n ? "is-selected" : ""} onClick={() => setSize(n)}>
            {n}
          </button>
        ))}
      </fieldset>
      <fieldset className="tourney-choices">
        <legend>Game</legend>
        {(["ludo", "snakes_and_ladders"] as const).map((g) => (
          <button key={g} type="button" className={gameType === g ? "is-selected" : ""} onClick={() => setGameType(g)}>
            {g === "ludo" ? "Ludo" : "Snakes & Ladders"}
          </button>
        ))}
      </fieldset>
      <label>
        <span>Check-in opens</span>
        <input type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
      </label>
      <label>
        <span>Starts</span>
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <div className="tourney-form-actions">
        <button type="button" className="panel-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="sim-primary" disabled={pending || !teamId || name.trim().length < 2}>
          Schedule
        </button>
      </div>
    </form>
  );
}
