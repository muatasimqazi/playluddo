"use client";

import { useEffect, useState } from "react";
import type { GameType, PlayerColor } from "@/lib/board/types";
import { chooseBotMove } from "@/lib/board/bot";
import {
  createPractice,
  practiceReducer,
  randomDie,
  type PracticeSession,
} from "@/lib/presentation/practice";
import Simulator from "./Simulator";

function requestedPlayerCount(): 2 | 3 | 4 | undefined {
  if (typeof window === "undefined") return undefined;
  const value = Number(new URLSearchParams(window.location.search).get("players"));
  return value === 2 || value === 3 || value === 4 ? value : undefined;
}

function requestedPlayerColor(): PlayerColor | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("color");
  return ["red", "green", "yellow", "blue"].includes(value ?? "")
    ? (value as PlayerColor)
    : undefined;
}

function load(
  gameType: GameType,
  playerCount?: 2 | 3 | 4,
  playerColor?: PlayerColor,
): PracticeSession {
  if (playerCount || playerColor)
    return createPractice(gameType, playerCount ?? 4, playerColor ?? "blue");
  try {
    const saved = JSON.parse(
      localStorage.getItem(
        gameType === "ludo" ? "luddo-practice-v1" : "luddo-snakes-practice-v1",
      ) ?? "null",
    );
    if (
      saved?.state?.roomId === "practice" &&
      [2, 3, 4].includes(saved.state.players?.length) &&
      saved.state.gameType === gameType &&
      saved.state.pawns?.length ===
        saved.state.players.length * (gameType === "ludo" ? 4 : 1) &&
      Array.isArray(saved.events)
    )
      return saved;
  } catch {}
  return createPractice(gameType);
}

export default function PracticeTable() {
  const [initialPlayerCount] = useState(requestedPlayerCount);
  const [initialPlayerColor] = useState(requestedPlayerColor);
  const [gameType, setGameType] = useState<GameType>(() => {
    try {
      return localStorage.getItem("luddo-practice-side") ===
        "snakes_and_ladders"
        ? "snakes_and_ladders"
        : "ludo";
    } catch {
      return "ludo";
    }
  });
  const [sessions, setSessions] = useState(() => ({
    ludo: load("ludo", initialPlayerCount, initialPlayerColor),
    snakes_and_ladders: load(
      "snakes_and_ladders",
      initialPlayerCount,
      initialPlayerColor,
    ),
  }));
  const session = sessions[gameType];
  const dispatch = (action: Parameters<typeof practiceReducer>[1]) =>
    setSessions((previous) => ({
      ...previous,
      [gameType]: practiceReducer(previous[gameType], action),
    }));
  const [generation, setGeneration] = useState(0);
  const state = session.state;
  useEffect(() => {
    try {
      localStorage.setItem(
        gameType === "ludo" ? "luddo-practice-v1" : "luddo-snakes-practice-v1",
        JSON.stringify(session),
      );
      localStorage.setItem("luddo-practice-side", gameType);
    } catch {}
  }, [session, gameType]);
  useEffect(() => {
    if (state.status !== "in_game" || state.turnPlayerId === "practice-0")
      return;
    const timer = setTimeout(
      () => {
        if (state.turnPhase === "awaiting_roll")
          setSessions((previous) => ({
            ...previous,
            [gameType]: practiceReducer(previous[gameType], {
              type: "roll",
              value: randomDie(),
            }),
          }));
        else if (state.turnPhase === "awaiting_move") {
          const move = chooseBotMove(state.legalMoves, state.pawns);
          if (move)
            setSessions((previous) => ({
              ...previous,
              [gameType]: practiceReducer(previous[gameType], {
                type: "move",
                pawnId: move.pawnId,
              }),
            }));
        }
      },
      gameType === "snakes_and_ladders" ? 5500 : 2100,
    );
    return () => clearTimeout(timer);
  }, [state, gameType]);
  return (
    <Simulator
      key={generation}
      state={state}
      events={session.events}
      myPlayerId="practice-0"
      practice
      playerCount={state.players.length as 2 | 3 | 4}
      onPlayerCountChange={(playerCount) => {
        setSessions((previous) => ({
          ...previous,
          [gameType]: createPractice(
            gameType,
            playerCount,
            state.players[0].color,
          ),
        }));
        setGeneration((n) => n + 1);
      }}
      onFlip={() =>
        setGameType((current) =>
          current === "ludo" ? "snakes_and_ladders" : "ludo",
        )
      }
      onRoll={() => {
        if (state.turnPlayerId === "practice-0")
          dispatch({ type: "roll", value: randomDie() });
      }}
      onMove={(pawnId) => {
        if (state.turnPlayerId === "practice-0")
          dispatch({ type: "move", pawnId });
      }}
      onRestart={() => {
        dispatch({ type: "reset" });
        setGeneration((n) => n + 1);
      }}
    />
  );
}
