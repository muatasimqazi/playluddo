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
import { tagRoomEntry } from "@/lib/analytics/entry";
import { PlayerProfileButton } from "@/components/profile/PlayerProfileButton";
import { COLORS } from "@/lib/presentation/board";
import { useI18n, type Translator } from "@/lib/i18n";

// Placement (1–4) → localized ordinal label. 0/undefined has no label.
function placeLabel(tx: Translator, placement: number): string {
  switch (placement) {
    case 1:
      return tx("tournaments.place1");
    case 2:
      return tx("tournaments.place2");
    case 3:
      return tx("tournaments.place3");
    case 4:
      return tx("tournaments.place4");
    default:
      return "";
  }
}

function roundName(tx: Translator, round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return tx("tournaments.roundFinal");
  if (fromEnd === 1) return tx("tournaments.roundSemi");
  return tx("tournaments.roundN", { round });
}

export function BracketView({ tournamentId }: { tournamentId: string }) {
  // `tx` (not `t`) — `t` is the tournament state below.
  const { t: tx, locale } = useI18n();
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
        if (!cancelled) setError(err instanceof Error ? err.message : tx("tournaments.loadErrorOne"));
      }
    }
    void load();
    // Poll while it's live or filling up.
    timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // `tx` is only read in the catch fallback; excluding it keeps a language
    // change from resetting the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tournamentId]);

  if (error)
    return (
      <div className="replay-message" role="alert">
        <p>{error}</p>
        <Link href="/tournaments" className="sim-primary">
          {tx("tournaments.backToTournaments")}
        </Link>
      </div>
    );
  if (!t)
    return (
      <div className="leaderboard-loading" aria-label={tx("tournaments.loadingBracket")}>
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
      setError(err instanceof Error ? err.message : tx("actions.genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="leaderboard-content bracket">
      <span className="eyebrow">
        {t.status === "active"
          ? tx("tournaments.liveTournament")
          : t.status === "scheduled"
            ? tx("tournaments.statusScheduled").toUpperCase()
            : t.status === "complete"
              ? tx("tournaments.statusComplete").toUpperCase()
              : t.status.toUpperCase()}
      </span>
      <h1>{t.name}</h1>

      {champion && (
        <div className="bracket-champion">
          <Icon name="trophy" size={20} />
          <div>
            <span className="eyebrow">{tx("tournaments.champion").toUpperCase()}</span>
            <PlayerProfileButton
              userId={champion.userId}
              displayName={champion.displayName}
              className="is-text"
            >
              <strong>{champion.displayName}</strong>
            </PlayerProfileButton>
          </div>
        </div>
      )}

      {myTable?.roomId && (
        <Link
          className="sim-primary"
          href={`/room?id=${myTable.roomId}`}
          onClick={() => tagRoomEntry(myTable.roomId!, { entry_point: "tournament", play_context: "tournament" })}
        >
          <Icon name="play" size={16} />
          {tx("tournaments.goToTable")}
        </Link>
      )}

      {t.status === "scheduled" && (
        <div className="bracket-checkin">
          <div>
            <span className="eyebrow">
              {(me
                ? me.checkedIn
                  ? tx("tournaments.checkedIn")
                  : tx("tournaments.checkIn")
                : tx("tournaments.notEntered")
              ).toUpperCase()}
            </span>
            <p>
              {tx("tournaments.entered", {
                entered: t.entrants.length,
                size: t.size,
                when: new Date(t.startsAt).toLocaleString(locale, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })}
            </p>
          </div>
          {me && !me.checkedIn && (
            <button type="button" className="sim-primary" disabled={pending || !checkInOpen} onClick={() => void checkIn()}>
              {checkInOpen ? tx("tournaments.checkInBtn") : tx("tournaments.checkInNotOpen")}
            </button>
          )}
        </div>
      )}

      {rounds.length === 0 ? (
        <div className="bracket-entrants">
          {t.entrants.map((e) => (
            <span key={e.userId} className={e.checkedIn ? "is-ready" : ""}>
              {e.checkedIn && <Icon name="check" size={12} />}
              <PlayerProfileButton userId={e.userId} displayName={e.displayName} className="is-text">
                {e.displayName}
              </PlayerProfileButton>
            </span>
          ))}
        </div>
      ) : (
        <div className="bracket-rounds">
          {rounds.map((round) => (
            <div key={round} className="bracket-round">
              <span className="eyebrow">{roundName(tx, round, totalRounds)}</span>
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
  const { t: tx } = useI18n();
  return (
    <div className={`bracket-table ${table.mine ? "is-mine" : ""}`}>
      <ol>
        {table.seats.map((seat, i) => (
          <li key={i} className={seat.placement && seat.placement <= 2 ? "is-advancing" : ""}>
            <span className="bracket-dot" style={{ background: COLORS[seat.color] }} />
            <PlayerProfileButton
              playerId={seat.playerId}
              displayName={seat.displayName}
              isBot={seat.isBot}
              className="is-text bracket-seat-name"
            >
              {seat.displayName}
            </PlayerProfileButton>
            {seat.placement ? <small>{placeLabel(tx, seat.placement)}</small> : null}
          </li>
        ))}
      </ol>
      {table.status === "in_progress" && table.roomId && !table.mine && (
        <Link className="bracket-watch" href={`/watch?room=${table.roomId}`}>
          <Icon name="look" size={13} /> {tx("tournaments.watch")}
        </Link>
      )}
    </div>
  );
}
