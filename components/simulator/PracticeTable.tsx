"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { GameType, PlayerColor } from "@/lib/board/types";
import { chooseBotMove } from "@/lib/board/bot";
import {
  createPractice,
  practiceReducer,
  randomDie,
  type PracticeSession,
} from "@/lib/presentation/practice";
import Simulator from "./Simulator";
import { createClient } from "@/lib/supabase/client";

function requestedPlayerCount(
  params: URLSearchParams,
): 2 | 3 | 4 | undefined {
  const value = Number(params.get("players"));
  return value === 2 || value === 3 || value === 4 ? value : undefined;
}

function requestedPlayerColor(params: URLSearchParams): PlayerColor | undefined {
  const value = params.get("color");
  return ["red", "green", "yellow", "blue"].includes(value ?? "")
    ? (value as PlayerColor)
    : undefined;
}

function requestedPlayerAvatar(params: URLSearchParams): string | undefined {
  return params.get("avatar") || undefined;
}

function load(
  gameType: GameType,
  playerCount?: 2 | 3 | 4,
  playerColor?: PlayerColor,
  playerAvatar?: string,
): PracticeSession {
  if (playerCount || playerColor || playerAvatar)
    return createPractice(gameType, playerCount ?? 4, playerColor ?? "blue", {
      avatarId: playerAvatar,
    });
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
  // Reactive to client-side navigation, unlike reading window.location.search
  // directly: Next.js's App Router doesn't remount this page for a
  // same-route navigation that only changes the query string (e.g. picking
  // a different player count on the entrance and landing back on
  // /practice?players=... again), so a one-time useState read of the URL
  // would keep showing whatever session was already loaded.
  const searchParams = useSearchParams();
  const [paused, setPaused] = useState(false);
  const [initialPlayerCount] = useState(() => requestedPlayerCount(searchParams));
  const [initialPlayerColor] = useState(() => requestedPlayerColor(searchParams));
  const [initialPlayerAvatar] = useState(() => requestedPlayerAvatar(searchParams));
  const appliedSearch = useRef(searchParams.toString());
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
    ludo: load(
      "ludo",
      initialPlayerCount,
      initialPlayerColor,
      initialPlayerAvatar,
    ),
    snakes_and_ladders: load(
      "snakes_and_ladders",
      initialPlayerCount,
      initialPlayerColor,
      initialPlayerAvatar,
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
    function applyIfNew() {
      const current = searchParams.toString();
      if (current === appliedSearch.current) return;
      appliedSearch.current = current;
      const playerCount = requestedPlayerCount(searchParams);
      const playerColor = requestedPlayerColor(searchParams);
      const playerAvatar = requestedPlayerAvatar(searchParams);
      if (!playerCount && !playerColor && !playerAvatar) return;
      const profile = { avatarId: playerAvatar };
      setSessions({
        ludo: createPractice(
          "ludo",
          playerCount ?? 4,
          playerColor ?? "blue",
          profile,
        ),
        snakes_and_ladders: createPractice(
          "snakes_and_ladders",
          playerCount ?? 4,
          playerColor ?? "blue",
          profile,
        ),
      });
      setGeneration((n) => n + 1);
    }
    applyIfNew();
  }, [searchParams]);
  useEffect(() => {
    // An avatar explicitly chosen on the entrance screen (or by an earlier
    // reactive re-apply above) wins over the signed-in profile's saved
    // avatar — otherwise this would silently overwrite it once the async
    // getUser() call resolves.
    if (initialPlayerAvatar) return;
    const client = createClient();
    void client.auth.getUser().then(({ data }) => {
      const metadata = data.user?.user_metadata;
      if (!data.user || !metadata?.avatar_id) return;
      setSessions((previous) => {
        const applyProfile = (current: PracticeSession): PracticeSession => ({
          ...current,
          state: {
            ...current.state,
            players: current.state.players.map((player, index) =>
              index === 0
                ? {
                    ...player,
                    displayName: metadata.display_name || player.displayName,
                    avatarId: metadata.avatar_id,
                    country: metadata.country || "",
                  }
                : player,
            ),
          },
        });
        return {
          ludo: applyProfile(previous.ludo),
          snakes_and_ladders: applyProfile(previous.snakes_and_ladders),
        };
      });
    });
  }, [initialPlayerAvatar]);
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
    if (paused || state.status !== "in_game" || state.turnPlayerId === "practice-0")
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
  }, [state, gameType, paused]);
  return (
    <Simulator
      key={generation}
      state={state}
      events={session.events}
      myPlayerId="practice-0"
      practice
      paused={paused}
      canPause
      onPause={(next) => setPaused(next)}
      playerCount={state.players.length as 2 | 3 | 4}
      onPlayerCountChange={(playerCount) => {
        setSessions((previous) => ({
          ...previous,
          [gameType]: createPractice(
            gameType,
            playerCount,
            state.players[0].color,
            state.players[0],
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
