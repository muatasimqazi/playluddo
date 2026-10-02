"use client";

import { useEffect } from "react";
import type { PracticeSession } from "../presentation/practice";
import { claimOnce } from "./dedupe";
import { gameParamsFromState, endReason } from "./gameParams";
import type { GameParams } from "./events";
import { track } from "./index";

/**
 * Offline games (practice against computers, Table Together): one device, so
 * one game is one player-game. The game id is the practice session's own
 * random id (lib/presentation/practice.ts), saved with the game, so a reload
 * that resumes a game never starts it twice.
 *
 * A game replaced while unfinished (restart, a new seat count, a new link
 * from the entrance) is reported as abandoned with `restarted` when its
 * replacement first shows up, even on a later visit. Leaving an offline game
 * is not an abandonment: it waits in the save to be resumed.
 */

const NOTES_KEY = "luddo-analytics-offline-v1";

interface SlotNote {
  id: string;
  /** When this device saw the game start (ms). Kept as long as the game is the slot's. */
  at: number;
  done: boolean;
  params: GameParams;
}

function readNotes(): Record<string, SlotNote> {
  try {
    return JSON.parse(window.localStorage.getItem(NOTES_KEY) || "{}") as Record<string, SlotNote>;
  } catch {
    return {};
  }
}

function writeNote(slot: string, note: SlotNote) {
  try {
    const all = readNotes();
    all[slot] = note;
    window.localStorage.setItem(NOTES_KEY, JSON.stringify(all));
  } catch {
    /* Private mode: a replaced game just goes unreported. */
  }
}

const seconds = (from: number, now = Date.now()) => Math.max(0, Math.round((now - from) / 1000));

export function useOfflineGameAnalytics(
  context: "practice" | "table_together",
  session: PracticeSession | null | undefined,
) {
  const gameId = session?.id;
  const status = session?.state.status;
  const gameType = session?.state.gameType;

  useEffect(() => {
    if (!session || !gameId || !gameType || (status !== "in_game" && status !== "summary")) return;
    const state = session.state;
    const slot = `${context}:${gameType}`;
    const params = gameParamsFromState(state, {
      game_id: gameId,
      play_context: context,
      bot_difficulty: context === "practice" ? session.botLevel ?? "normal" : undefined,
    });
    const previous = readNotes()[slot];
    const replaced = previous && previous.id !== gameId ? previous : undefined;
    if (replaced && !replaced.done && claimOnce(`game_done:${replaced.id}`))
      track("game_abandoned", {
        ...replaced.params,
        abandon_reason: "restarted",
        duration_seconds: seconds(replaced.at),
      });

    // The slot's note outlives the 48-hour once-keys, so a game resumed days
    // later is never started twice.
    const known = previous && previous.id === gameId ? previous : undefined;
    const startedAt = known?.at ?? Date.now();
    if (!known && status === "in_game")
      track(
        "game_started",
        { ...params, entry_point: replaced?.done ? "rematch" : "offline", is_host: true },
        { once: `game_started:${gameId}` },
      );

    let done = !!known?.done;
    if (status === "summary") {
      if (known && !known.done && claimOnce(`game_done:${gameId}`)) {
        // Table Together seats several people on one device: no single place to report.
        const human = context === "practice" ? "practice-0" : null;
        const place = human ? state.winnerIds.indexOf(human) + 1 : 0;
        track("game_completed", {
          ...params,
          duration_seconds: seconds(known.at),
          finish_place: place > 0 ? place : undefined,
          won: human ? state.winnerIds[0] === human : undefined,
          end_reason: endReason(state),
        });
      }
      done = true;
    }
    // A game first seen already finished (a save from before analytics) is noted but never reported.
    writeNote(slot, { id: gameId, at: startedAt, done: done || (!known && status === "summary"), params });
    // Only a new game or a new status matters; moves don't re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, gameId, gameType, status]);
}
