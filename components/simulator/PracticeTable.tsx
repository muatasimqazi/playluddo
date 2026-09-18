"use client";

import { useEffect, useState } from "react";
import type { GameType } from "@/lib/board/types";
import { chooseBotMove } from "@/lib/board/bot";
import {
  createPractice,
  practiceReducer,
  randomDie,
  type PracticeSession,
} from "@/lib/presentation/practice";
import Simulator from "./Simulator";

function load(gameType: GameType): PracticeSession {
  try {
    const saved = JSON.parse(
      localStorage.getItem(
        gameType === "ludo" ? "luddo-practice-v1" : "luddo-snakes-practice-v1",
      ) ?? "null",
    );
    if (
      saved?.state?.roomId === "practice" &&
      saved.state.players?.length === 4 &&
      saved.state.gameType === gameType &&
      saved.state.pawns?.length === (gameType === "ludo" ? 16 : 4) &&
      Array.isArray(saved.events)
    )
      return saved;
  } catch {}
  return createPractice(gameType);
}

export default function PracticeTable() {
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
    ludo: load("ludo"),
    snakes_and_ladders: load("snakes_and_ladders"),
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
