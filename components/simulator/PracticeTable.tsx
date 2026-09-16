"use client";

import { useEffect, useReducer, useState } from "react";
import { chooseBotMove } from "@/lib/board/bot";
import {
  createPractice,
  practiceReducer,
  randomDie,
  type PracticeSession,
} from "@/lib/presentation/practice";
import Simulator from "./Simulator";

function load(): PracticeSession {
  try {
    const saved = JSON.parse(
      localStorage.getItem("luddo-practice-v1") ?? "null",
    );
    if (
      saved?.state?.roomId === "practice" &&
      saved.state.players?.length === 4 &&
      saved.state.pawns?.length === 16 &&
      Array.isArray(saved.events)
    )
      return saved;
  } catch {}
  return createPractice();
}

export default function PracticeTable() {
  const [session, dispatch] = useReducer(practiceReducer, undefined, load);
  const [generation, setGeneration] = useState(0);
  const state = session.state;
  useEffect(() => {
    try {
      localStorage.setItem("luddo-practice-v1", JSON.stringify(session));
    } catch {}
  }, [session]);
  useEffect(() => {
    if (state.status !== "in_game" || state.turnPlayerId === "practice-0")
      return;
    const timer = setTimeout(() => {
      if (state.turnPhase === "awaiting_roll")
        dispatch({ type: "roll", value: randomDie() });
      else if (state.turnPhase === "awaiting_move") {
        const move = chooseBotMove(state.legalMoves, state.pawns);
        if (move) dispatch({ type: "move", pawnId: move.pawnId });
      }
    }, 2100);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <Simulator
      key={generation}
      state={state}
      events={session.events}
      myPlayerId="practice-0"
      practice
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
