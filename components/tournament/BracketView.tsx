"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import {
  checkInTournament,
  getTournament,
  type Tournament,
  type TournamentTable,
} from "@/lib/supabase/tournaments";
import { Icon } from "@/components/simulator/Icon";
import { COLORS } from "@/lib/presentation/board";

const PLACE = ["", "1st", "2nd", "3rd", "4th"];

function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semi-finals";
  return `Round ${round}`;
}

export function BracketView({ tournamentId }: { tournamentId: string }) {
  const client = useMemo(() => createClient(), []);
  const [t, setT] = useState<Tournament | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function load() {
      try {
        await ensureSession(client);
        const data = await getTournament(client, tournamentId);
        if (!cancelled) {
          setT(data);
          setNow(Date.now());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this tournament.");
      }
    }
    void load();
    // Poll while it's live or filling up.
    timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [client, tournamentId]);

  if (error)
    return (
      <div className="replay-message" role="alert">
        <p>{error}</p>
        <Link href="/tournaments" className="sim-primary">
          Back to tournaments
        </Link>
      </div>
    );
  if (!t)
    return (
      <div className="leaderboard-loading" aria-label="Loading the bracket">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
    );

  const me = t.entrants.find((e) => e.userId === t.myUserId);
  const checkInOpen =
    t.status === "scheduled" &&
    now >= new Date(t.checkInOpensAt).getTime() &&
    now <= new Date(t.startsAt).getTime();
  const myTable = t.tables.find((tbl) => tbl.mine && tbl.status === "in_progress");
  const rounds = [...new Set(t.tables.map((tbl) => tbl.round))].sort((a, b) => a - b);
  const totalRounds = t.size === 16 ? 3 : 2;
  const champion =
    t.status === "complete" && t.winnerUserId
      ? t.entrants.find((e) => e.userId === t.winnerUserId)
      : null;

  async function checkIn() {
    setPending(true);
    setError(null);
    try {
      await checkInTournament(client, tournamentId);
      setT(await getTournament(client, tournamentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="leaderboard-content bracket">
      <span className="eyebrow">
        {t.status === "active" ? "LIVE TOURNAMENT" : t.status.toUpperCase()}
      </span>
      <h1>{t.name}</h1>

      {champion && (
        <div className="bracket-champion">
          <Icon name="trophy" size={20} />
          <div>
            <span className="eyebrow">CHAMPION</span>
            <strong>{champion.displayName}</strong>
          </div>
        </div>
      )}

      {myTable?.roomId && (
        <Link className="sim-primary" href={`/room?id=${myTable.roomId}`}>
          <Icon name="play" size={16} />
          Go to your table
        </Link>
      )}

      {t.status === "scheduled" && (
        <div className="bracket-checkin">
          <div>
            <span className="eyebrow">
              {me ? (me.checkedIn ? "YOU'RE CHECKED IN" : "CHECK IN") : "NOT ENTERED"}
            </span>
            <p>
              {t.entrants.length}/{t.size} entered · starts{" "}
              {new Date(t.startsAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </div>
          {me && !me.checkedIn && (
            <button type="button" className="sim-primary" disabled={pending || !checkInOpen} onClick={() => void checkIn()}>
              {checkInOpen ? "Check in" : "Check-in not open yet"}
            </button>
          )}
        </div>
      )}

      {rounds.length === 0 ? (
        <div className="bracket-entrants">
          {t.entrants.map((e) => (
            <span key={e.userId} className={e.checkedIn ? "is-ready" : ""}>
              {e.checkedIn && <Icon name="check" size={12} />}
              {e.displayName}
            </span>
          ))}
        </div>
      ) : (
        <div className="bracket-rounds">
          {rounds.map((round) => (
            <div key={round} className="bracket-round">
              <span className="eyebrow">{roundName(round, totalRounds)}</span>
              {t.tables
                .filter((tbl) => tbl.round === round)
                .map((tbl) => (
                  <TableCard key={`${round}-${tbl.tableIndex}`} table={tbl} />
                ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TableCard({ table }: { table: TournamentTable }) {
  return (
    <div className={`bracket-table ${table.mine ? "is-mine" : ""}`}>
      <ol>
        {table.seats.map((seat, i) => (
          <li key={i} className={seat.placement && seat.placement <= 2 ? "is-advancing" : ""}>
            <span className="bracket-dot" style={{ background: COLORS[seat.color] }} />
            <span className="bracket-seat-name">{seat.displayName}</span>
            {seat.placement ? <small>{PLACE[seat.placement]}</small> : null}
          </li>
        ))}
      </ol>
      {table.status === "in_progress" && table.roomId && !table.mine && (
        <Link className="bracket-watch" href={`/watch?room=${table.roomId}`}>
          <Icon name="look" size={13} /> Watch
        </Link>
      )}
    </div>
  );
}
