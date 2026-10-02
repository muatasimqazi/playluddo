"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { cancelMatchmaking, matchmake } from "@/lib/supabase/rpc";
import type { GameType } from "@/lib/board/types";
import { Icon } from "@/components/simulator/Icon";
import { useI18n, type Translator } from "@/lib/i18n";
import { useAgeCheck } from "@/components/lobby/AgeCheck";
import { errorCode, track, trackError } from "@/lib/analytics";
import { tagRoomEntry } from "@/lib/analytics/entry";
import { analyticsGameType } from "@/lib/analytics/gameParams";

const POLL_MS = 2000;
const TIMEOUT_SECONDS = 45;
// Long enough to read "Opponent found" before the room takes over.
const HANDOFF_MS = 900;

type Phase =
  | { kind: "searching" }
  | { kind: "matched"; players: number; computers: number }
  | { kind: "error"; message: string };

/**
 * The quick-match waiting screen: keeps the player in the server's queue
 * (public.matchmake, polled every 2s — which also tells the server they're
 * still here), counts down the 45s the server waits for a real opponent
 * before seating a computer, and hands off to the room once matched. Every
 * pairing decision is made server-side; this only polls and displays.
 */
export function QuickMatch({
  gameType,
  playerCount,
  displayName,
  onCancel,
}: {
  gameType: GameType;
  playerCount: 2 | 3 | 4;
  displayName: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const { t: tx } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: "searching" });
  const [elapsed, setElapsed] = useState(0);
  const [found, setFound] = useState(0);
  // Server-reported wait, anchored to the local clock so the countdown
  // runs smoothly between polls instead of jumping every 2s.
  const startedAt = useRef<number | null>(null);
  // The poll loop currently in charge. Each effect run gets its own —
  // a shared flag would let a remount (React's dev double-mount, or "Try
  // again") flip it back and revive the previous loop alongside the new
  // one. cancel() stops it and waits out any poll already in flight, so
  // that poll can't re-queue the player after they've left.
  const run = useRef<{
    stopped: boolean;
    settled: boolean;
    inFlight: Promise<unknown> | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const age = useAgeCheck();
  const handleAge = age.handle;
  // Analytics: how long this search ran, and the room it ended in.
  const searchStartedAt = useRef<number | null>(null);
  const waitSeconds = () =>
    searchStartedAt.current === null ? undefined : Math.round((Date.now() - searchStartedAt.current) / 1000);
  const reportMatched = (roomId: string, players: number, computers: number) => {
    tagRoomEntry(roomId, { entry_point: "quick_match", play_context: "quick_match" });
    track("match_found", {
      game_type: analyticsGameType(gameType),
      seat_count: players,
      human_count: players - computers,
      bot_count: computers,
      wait_seconds: waitSeconds(),
    });
  };

  useEffect(() => {
    const client = createClient();
    const current = { stopped: false, settled: false, inFlight: null as Promise<unknown> | null };
    run.current = current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    startedAt.current = null;

    async function poll() {
      if (current.stopped) return;
      try {
        const request = matchmake(client, gameType, displayName, playerCount);
        current.inFlight = request;
        const result = await request;
        if (current.stopped) return;
        if (result.status === "matched") {
          current.settled = true;
          reportMatched(result.roomId, result.players, result.computers);
          setPhase({ kind: "matched", players: result.players, computers: result.computers });
          timer = setTimeout(() => router.push(`/room?id=${result.roomId}`), HANDOFF_MS);
          return;
        }
        if (result.status === "waiting") {
          startedAt.current ??= Date.now() - result.waitedSeconds * 1000;
          setFound(result.found);
        }
        timer = setTimeout(poll, POLL_MS);
      } catch (error) {
        if (current.stopped) return;
        // The age check runs before the player is queued, so there's no
        // queue entry to cancel; answering it starts the search again.
        const askedForAge = handleAge(error, () => {
          setPhase({ kind: "searching" });
          setElapsed(0);
          setAttempt((n) => n + 1);
        });
        if (!askedForAge) trackError("matchmaking", errorCode(error));
        setPhase({
          kind: "error",
          message: askedForAge
            ? tx("quickMatch.needBirthFirst")
            : error instanceof Error
              ? error.message
              : tx("quickMatch.couldNotReach"),
        });
      }
    }

    ensureSession(client).then(
      () => {
        if (current.stopped) return;
        searchStartedAt.current = Date.now();
        track("matchmaking_started", { game_type: analyticsGameType(gameType), seat_count: playerCount });
        void poll();
      },
      (error: unknown) => {
        if (current.stopped) return;
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : tx("quickMatch.couldNotSignIn"),
        });
      },
    );
    return () => {
      current.stopped = true;
      // A pending handoff still goes ahead: the player is already seated.
      if (!current.settled) clearTimeout(timer);
      // Leaving this screen without a match (closing the panel, navigating
      // away) takes the player out of the queue so nobody gets paired with
      // an empty seat. Waits for any in-flight poll first so it can't land
      // after the cancel and re-queue them. Best effort — the server also
      // stops offering anyone who hasn't polled for 8s.
      if (!current.settled)
        void (current.inFlight ?? Promise.resolve())
          .catch(() => {})
          .then(() => cancelMatchmaking(client))
          .catch(() => {});
    };
    // `tx` is only read in the error branches; excluding it keeps a language
    // change from restarting the matchmaking poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameType, playerCount, displayName, router, attempt, handleAge]);

  useEffect(() => {
    if (phase.kind !== "searching") return;
    const tick = setInterval(() => {
      if (startedAt.current !== null)
        setElapsed((Date.now() - startedAt.current) / 1000);
    }, 200);
    return () => clearInterval(tick);
  }, [phase.kind]);

  async function cancel() {
    const client = createClient();
    const current = run.current;
    if (current) {
      current.stopped = true;
      current.settled = true; // this handles the queue exit, not the cleanup
      await current.inFlight?.catch(() => {});
    }
    try {
      // A pairing may have landed between polls — honor it rather than
      // strand the opponent at an empty seat.
      const result = await cancelMatchmaking(client);
      if (result.status === "matched") {
        reportMatched(result.roomId, result.players, result.computers);
        router.push(`/room?id=${result.roomId}`);
        return;
      }
      track("matchmaking_cancelled", { wait_seconds: waitSeconds() });
    } catch {
      // Nothing to undo; the queue row expires on its own.
    }
    onCancel();
  }

  const remaining = Math.max(0, Math.ceil(TIMEOUT_SECONDS - elapsed));
  const progress = Math.min(1, elapsed / TIMEOUT_SECONDS);
  const gameName = gameType === "ludo" ? tx("entrance.ludo") : tx("entrance.snakes");
  const needed = playerCount - 1;
  const seatsFound = tx(needed === 1 ? "quickMatch.opponentFound" : "quickMatch.opponentsFound", {
    found,
    needed,
  });

  // [first line, emphasized second line] for whichever phase is showing.
  const headline: [string, string] =
    phase.kind === "matched"
      ? matchedHeadline(tx, phase.players, phase.computers)
      : phase.kind === "error"
        ? [tx("quickMatch.errorTitle1"), tx("quickMatch.errorTitleEm")]
        : needed === 1
          ? [tx("quickMatch.searchOpponent1"), tx("quickMatch.searchOpponentEm")]
          : [tx("quickMatch.searchTable1"), tx("quickMatch.searchTableEm")];

  return (
    <>
      {age.gate}
      <div className="quick-match" role="status" aria-live="polite">
        <span className="eyebrow">
          {tx("quickMatch.eyebrow").toUpperCase()} · {gameName.toUpperCase()}
        </span>
        {phase.kind === "matched" ? (
          <>
            <h1 style={{ fontSize: 44 }}>
              {headline[0]}
              <br />
              <em>{headline[1]}</em>
            </h1>
            <p className="quick-match-note">
              {matchedLineup(tx, phase.players, phase.computers)} {tx("quickMatch.settingTable")}
            </p>
          </>
        ) : phase.kind === "error" ? (
          <>
            <h1 style={{ fontSize: 40 }}>
              {headline[0]}
              <br />
              <em>{headline[1]}</em>
            </h1>
            <p className="quick-match-note">{phase.message}</p>
            <div className="quick-match-actions">
              <button
                type="button"
                className="sim-primary"
                onClick={() => {
                  setPhase({ kind: "searching" });
                  setElapsed(0);
                  setAttempt((n) => n + 1);
                }}
              >
                <span>{tx("actions.retry")}</span>
                <Icon name="arrow" />
              </button>
              <button type="button" className="back-button" onClick={onCancel}>
                {tx("common.backArrow")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 44 }}>
              {headline[0]}
              <br />
              <em>{headline[1]}</em>
            </h1>
            <div className="quick-match-timer">
              <svg viewBox="0 0 100 100" aria-hidden>
                <circle cx="50" cy="50" r="44" className="quick-match-track" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  className="quick-match-progress"
                  style={{ strokeDashoffset: 276.46 * progress }}
                />
              </svg>
              <strong>{remaining}</strong>
              <small>{tx("quickMatch.sec")}</small>
            </div>
            <div className="quick-match-seats" aria-label={seatsFound}>
              {Array.from({ length: needed }, (_, i) => (
                <i key={i} className={i < found ? "is-filled" : undefined} />
              ))}
              <span>{seatsFound}</span>
            </div>
            <p className="quick-match-note">
              {tx(needed === 1 ? "quickMatch.lookingForOne" : "quickMatch.lookingForMany", {
                others: needed,
                count: playerCount,
                game: gameName,
                seconds: TIMEOUT_SECONDS,
              })}
            </p>
            <div className="quick-match-actions">
              <button type="button" className="back-button" onClick={() => void cancel()}>
                {tx("quickMatch.cancelArrow")}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// Returns the [first line, emphasized second line] for the matched headline.
// The whole second line is emphasized (rather than one word) so the phrasing
// stays natural across languages with different word order.
function matchedHeadline(tx: Translator, players: number, computers: number): [string, string] {
  const humans = players - computers;
  if (computers === 0)
    return players === 2
      ? [tx("quickMatch.matchedOpponentFound1"), tx("quickMatch.matchedOpponentFoundEm")]
      : [tx("quickMatch.matchedTableFull1"), tx("quickMatch.matchedTableFullEm")];
  if (humans === 1)
    return computers === 1
      ? [tx("quickMatch.matchedComputerSeat1"), tx("quickMatch.matchedComputerSeatEm")]
      : [tx("quickMatch.matchedComputerSeats1"), tx("quickMatch.matchedComputerSeatsEm")];
  return [tx("quickMatch.matchedLetsPlay1"), tx("quickMatch.matchedLetsPlayEm")];
}

function matchedLineup(tx: Translator, players: number, computers: number): string {
  const others = players - computers - 1;
  const people =
    others === 0
      ? ""
      : tx(others === 1 ? "quickMatch.playerOnline" : "quickMatch.playersOnline", { count: others });
  const bots =
    computers === 0
      ? ""
      : tx(computers === 1 ? "quickMatch.computerOne" : "quickMatch.computersN", { count: computers });
  if (people && bots) return tx("quickMatch.lineupPeopleAndBots", { people, bots });
  if (people) return tx("quickMatch.lineupPeopleOnly", { people });
  return tx("quickMatch.lineupBotsOnly", { bots });
}
