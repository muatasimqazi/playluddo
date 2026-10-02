"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ProfilePanel } from "@/components/auth/ProfilePanel";
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
import { track } from "@/lib/analytics";
import { analyticsGameType } from "@/lib/analytics/gameParams";
import { ProfileHeaderLink } from "@/components/profile/ProfileHeaderLink";
import { useI18n, type LocaleCode } from "@/lib/i18n";
import "@/components/simulator/simulator.css";

function whenLabel(iso: string, locale: LocaleCode): string {
  return new Date(iso).toLocaleString(locale, {
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

/** These pages show no name from the profile panel; it only signs players in here. */
const ignoreName = () => {};

export default function TournamentsPage() {
  // `tx` (not `t`) avoids colliding with the `t` tournament item used in the
  // list below — the same convention the other migrated components use.
  const { t: tx, locale } = useI18n();
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
    // Signing in from the header's profile panel updates the page in place.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (session) setUser(session.user);
    });
    return () => data.subscription.unsubscribe();
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
        if (!cancelled) setError(err instanceof Error ? err.message : tx("tournaments.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // `tx` is only read in the catch fallback; excluding it keeps a language
    // change from refetching the whole list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, user, authenticated]);

  return (
    <main className="sim-entrance leaderboard-page">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand" aria-label={tx("actions.homeLabel")}>
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
            <small>{tx("actions.backHome")}</small>
          </Link>
        </div>
      </header>

      <section className="leaderboard-content">
        <span className="eyebrow">{tx("tournaments.eyebrow").toUpperCase()}</span>
        <h1>
          {tx("tournaments.titlePre")}
          <em>{tx("tournaments.titleEm")}</em>
        </h1>

        {error && (
          <p role="alert" className="leaderboard-message is-error">
            {error}
          </p>
        )}

        {loading ? (
          <div className="leaderboard-loading" aria-label={tx("tournaments.loading")}>
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
        ) : !authenticated ? (
          <p className="leaderboard-message">{tx("tournaments.signInPrompt")}</p>
        ) : teams.length === 0 ? (
          <p className="leaderboard-message">{tx("tournaments.needTeam")}</p>
        ) : (
          <>
            {tournaments.length === 0 ? (
              <p className="leaderboard-message">{tx("tournaments.none")}</p>
            ) : (
              <div className="tourney-list">
                {tournaments.map((t) => (
                  <div key={t.id} className="tourney-row">
                    <div className="tourney-row-main">
                      <strong>{t.name}</strong>
                      <small>
                        {t.teamName} · {tx("tournaments.playersCount", { count: t.size })} ·{" "}
                        {t.status === "active" ? tx("tournaments.liveNow") : whenLabel(t.startsAt, locale)}
                      </small>
                    </div>
                    <span className={`tourney-badge is-${t.status}`}>
                      {t.status === "active" ? tx("tournaments.live") : `${t.entrantCount}/${t.size}`}
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
                            track("tournament_joined", {});
                            await refresh();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : tx("tournaments.joinError"));
                          } finally {
                            setPending(false);
                          }
                        }}
                      >
                        {tx("actions.join")}
                      </button>
                    ) : (
                      <Link href={`/tournaments/view?id=${t.id}`} className="panel-secondary">
                        {t.status === "active" ? tx("tournaments.openBracket") : tx("actions.view")}
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
                    track("tournament_created", { size: values.size, game_type: analyticsGameType(values.gameType) });
                    setCreating(false);
                    await refresh();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : tx("tournaments.createError"));
                  } finally {
                    setPending(false);
                  }
                }}
              />
            ) : (
              <button type="button" className="sim-primary" onClick={() => setCreating(true)}>
                <Icon name="bracket" size={16} />
                {tx("tournaments.schedule")}
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
  const { t: tx } = useI18n();
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
        <span>{tx("actions.team")}</span>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{tx("actions.name")}</span>
        <input value={name} maxLength={40} required minLength={2} onChange={(e) => setName(e.target.value)} />
      </label>
      <fieldset className="tourney-choices">
        <legend>{tx("actions.players")}</legend>
        {([8, 16] as const).map((n) => (
          <button key={n} type="button" className={size === n ? "is-selected" : ""} onClick={() => setSize(n)}>
            {n}
          </button>
        ))}
      </fieldset>
      <fieldset className="tourney-choices">
        <legend>{tx("tournaments.game")}</legend>
        {(["ludo", "snakes_and_ladders"] as const).map((g) => (
          <button key={g} type="button" className={gameType === g ? "is-selected" : ""} onClick={() => setGameType(g)}>
            {g === "ludo" ? tx("entrance.ludo") : tx("entrance.snakes")}
          </button>
        ))}
      </fieldset>
      <label>
        <span>{tx("tournaments.checkInOpens")}</span>
        <input type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
      </label>
      <label>
        <span>{tx("tournaments.starts")}</span>
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <div className="tourney-form-actions">
        <button type="button" className="panel-secondary" onClick={onCancel}>
          {tx("actions.cancel")}
        </button>
        <button type="submit" className="sim-primary" disabled={pending || !teamId || name.trim().length < 2}>
          {tx("tournaments.scheduleShort")}
        </button>
      </div>
    </form>
  );
}
