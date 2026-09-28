"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { cancelMatchmaking, matchmake } from "@/lib/supabase/rpc";
import type { GameType } from "@/lib/board/types";
import { Icon } from "@/components/simulator/Icon";
import { useAgeCheck } from "@/components/lobby/AgeCheck";

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
        setPhase({
          kind: "error",
          message: askedForAge
            ? "Online tables need your birth month and year first."
            : error instanceof Error
              ? error.message
              : "Could not reach the table.",
        });
      }
    }

    ensureSession(client).then(
      () => {
        if (!current.stopped) void poll();
      },
      (error: unknown) => {
        if (current.stopped) return;
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not sign in to play online.",
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
        router.push(`/room?id=${result.roomId}`);
        return;
      }
    } catch {
      // Nothing to undo; the queue row expires on its own.
    }
    onCancel();
  }

  const remaining = Math.max(0, Math.ceil(TIMEOUT_SECONDS - elapsed));
  const progress = Math.min(1, elapsed / TIMEOUT_SECONDS);
  const gameName = gameType === "ludo" ? "Ludo" : "Snakes & Ladders";
  const needed = playerCount - 1;

  return (
    <>
      {age.gate}
      <div className="quick-match" role="status" aria-live="polite">
        <span className="eyebrow">QUICK MATCH · {gameName.toUpperCase()}</span>
        {phase.kind === "matched" ? (
          <>
            <h1 style={{ fontSize: 44 }}>{matchedHeadline(phase.players, phase.computers)}</h1>
            <p className="quick-match-note">
              {matchedLineup(phase.players, phase.computers)} Setting the table…
            </p>
          </>
        ) : phase.kind === "error" ? (
          <>
            <h1 style={{ fontSize: 40 }}>
              Couldn&apos;t reach
              <br />
              the <em>table.</em>
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
                <span>Try again</span>
                <Icon name="arrow" />
              </button>
              <button type="button" className="back-button" onClick={onCancel}>
                ← Back
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 44 }}>
              Finding you
              <br />
              {needed === 1 ? (
                <>
                  an <em>opponent.</em>
                </>
              ) : (
                <>
                  a <em>table.</em>
                </>
              )}
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
              <small>sec</small>
            </div>
            <div className="quick-match-seats" aria-label={`${found} of ${needed} opponents found`}>
              {Array.from({ length: needed }, (_, i) => (
                <i key={i} className={i < found ? "is-filled" : undefined} />
              ))}
              <span>
                {found} of {needed} {needed === 1 ? "opponent" : "opponents"} found
              </span>
            </div>
            <p className="quick-match-note">
              Looking for {needed === 1 ? "someone else" : `${needed} others`} starting a{" "}
              {playerCount}-player {gameName} game. The table starts as soon as it fills — or
              after {TIMEOUT_SECONDS} seconds, with computer players in any empty seats.
            </p>
            <div className="quick-match-actions">
              <button type="button" className="back-button" onClick={() => void cancel()}>
                ← Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function matchedHeadline(players: number, computers: number) {
  const humans = players - computers;
  if (computers === 0)
    return players === 2 ? (
      <>
        Opponent
        <br />
        <em>found.</em>
      </>
    ) : (
      <>
        The table&apos;s
        <br />
        <em>full.</em>
      </>
    );
  if (humans === 1)
    return computers === 1 ? (
      <>
        A computer
        <br />
        takes the <em>seat.</em>
      </>
    ) : (
      <>
        Computers take
        <br />
        the <em>seats.</em>
      </>
    );
  return (
    <>
      Let&apos;s
      <br />
      <em>play.</em>
    </>
  );
}

function matchedLineup(players: number, computers: number) {
  const others = players - computers - 1;
  const people = others === 0 ? "" : `${others} ${others === 1 ? "player" : "players"} online`;
  const bots = computers === 0 ? "" : `${computers} ${computers === 1 ? "computer" : "computers"}`;
  return `You vs ${[people, bots].filter(Boolean).join(" and ")}.`;
}
