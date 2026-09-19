"use client";

import { useEffect, useState } from "react";
import type { GameType } from "@/lib/board/types";
import {
  createPractice,
  practiceReducer,
  randomDie,
  type PracticeSession,
} from "@/lib/presentation/practice";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import Simulator from "./Simulator";

const DEFAULT_NAMES = ["Player 1", "Player 2", "Player 3", "Player 4"];

function requestedPlayerCount(): 2 | 3 | 4 {
  const value = Number(new URLSearchParams(window.location.search).get("players"));
  return value === 2 || value === 3 || value === 4 ? value : 2;
}

function newSession(gameType: GameType, names: string[]): PracticeSession {
  const session = createPractice(gameType, names.length as 2 | 3 | 4, "red");
  return {
    ...session,
    state: {
      ...session.state,
      roomId: "table-together",
      code: "LOCAL",
      players: session.state.players.map((player, index) => ({
        ...player,
        displayName: names[index].trim() || DEFAULT_NAMES[index],
        isBot: false,
        status: "connected" as const,
      })),
    },
  };
}

export default function TableTogether() {
  const [count, setCount] = useState<2 | 3 | 4>(requestedPlayerCount);
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [sessions, setSessions] = useState<{
    ludo: PracticeSession;
    snakes_and_ladders: PracticeSession;
  } | null>(null);
  const [gameType, setGameType] = useState<GameType>("ludo");
  const [readyPlayerId, setReadyPlayerId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [handoffPlayerId, setHandoffPlayerId] = useState<string | null>(null);
  const session = sessions?.[gameType];
  const state = session?.state;
  const turnPlayer = state?.players.find((player) => player.id === state.turnPlayerId);
  const needsHandoff =
    !!state && !paused && state.status === "in_game" && readyPlayerId !== state.turnPlayerId;

  useEffect(() => {
    if (!state?.turnPlayerId || state.status !== "in_game") return;
    const delay = readyPlayerId ? 950 : 0;
    const timer = window.setTimeout(
      () => setHandoffPlayerId(state.turnPlayerId),
      delay,
    );
    return () => window.clearTimeout(timer);
  }, [readyPlayerId, state?.status, state?.turnPlayerId]);

  useEffect(() => {
    if (!sessions) return;
    try {
      localStorage.setItem("luddo-table-together-v1", JSON.stringify({ sessions, gameType }));
    } catch {}
  }, [gameType, sessions]);

  function start() {
    const playerNames = names.slice(0, count);
    setSessions({
      ludo: newSession("ludo", playerNames),
      snakes_and_ladders: newSession("snakes_and_ladders", playerNames),
    });
    setReadyPlayerId(null);
  }

  if (!session || !state) {
    return (
      <main className="together-setup">
        <section className="together-card">
          <span className="eyebrow">ONE SCREEN · ONE TABLE</span>
          <h1>Table Together</h1>
          <p>Pass the device when the turn changes. Every seat belongs to someone in the room.</p>
          <fieldset>
            <legend>Players</legend>
            <div className="together-count">
              {([2, 3, 4] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={count === value ? "is-selected" : ""}
                  onClick={() => setCount(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="together-names">
            {Array.from({ length: count }, (_, index) => (
              <label key={index}>
                <span>Player {index + 1}</span>
                <input
                  value={names[index]}
                  maxLength={24}
                  onChange={(event) =>
                    setNames((current) => current.map((name, i) => (i === index ? event.target.value : name)))
                  }
                />
              </label>
            ))}
          </div>
          <button type="button" className="sim-primary" onClick={start}>
            Take your seats
          </button>
        </section>
      </main>
    );
  }

  const dispatch = (action: Parameters<typeof practiceReducer>[1]) =>
    setSessions((current) =>
      current
        ? { ...current, [gameType]: practiceReducer(current[gameType], action) }
        : current,
    );

  return (
    <>
      <Simulator
        state={state}
        events={session.events}
        myPlayerId={needsHandoff ? null : state.turnPlayerId}
        localPlay
        practice
        paused={paused}
        canPause
        onPause={(next) => setPaused(next)}
        onRoll={() => dispatch({ type: "roll", value: randomDie() })}
        onMove={(pawnId) => dispatch({ type: "move", pawnId })}
        onFlip={() => {
          setGameType((current) =>
            current === "ludo" ? "snakes_and_ladders" : "ludo",
          );
          setReadyPlayerId(null);
        }}
        onRestart={() => {
          setSessions((current) =>
            current
              ? {
                  ...current,
                  [gameType]: newSession(
                    gameType,
                    state.players.map((player) => player.displayName),
                  ),
                }
              : current,
          );
          setReadyPlayerId(null);
        }}
      />
      {needsHandoff && handoffPlayerId === state.turnPlayerId && turnPlayer && (
        <div className="together-handoff" role="dialog" aria-label={`${turnPlayer.displayName}'s turn`}>
          <section>
            <PlayerAvatar player={turnPlayer} size={58} />
            <div>
              <span className="eyebrow">PASS THE DEVICE</span>
              <h2>{turnPlayer.displayName}, you’re up.</h2>
              <p>The board is ready for your turn.</p>
            </div>
            <button
              type="button"
              className="sim-primary"
              onClick={() => setReadyPlayerId(turnPlayer.id)}
            >
              I’m ready
            </button>
          </section>
        </div>
      )}
    </>
  );
}
