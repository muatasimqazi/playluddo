"use client";

import { useEffect, useRef } from "react";
import type { GameRoomState } from "../board/types";
import type { MatchEventRow } from "../realtime/room-channel";
import { claimOnce, sentRecord } from "./dedupe";
import { analyticsGameType, gameModeOf } from "./gameParams";
import type { PartyGameParams } from "./events";
import { track } from "./index";

/**
 * Party Mode from the TV (docs/analytics.md, "Party Mode"). The TV is the one
 * device that sees every party game once, so it reports games, pauses and
 * their endings; the phones report only their own seats. Keys are per match
 * on this TV, so reloading the screen never repeats an event.
 */

function partyParams(state: GameRoomState, audienceCount: number | undefined): PartyGameParams {
  const humans = state.players.filter((p) => !p.isBot);
  return {
    game_id: state.matchId ?? "",
    game_type: analyticsGameType(state.gameType),
    game_mode: gameModeOf(state).game_mode,
    human_count: humans.length,
    bot_count: state.players.length - humans.length,
    remote_count: humans.filter((p) => p.partyRemote).length,
    audience_count: audienceCount,
  };
}

export function usePartyScreenAnalytics(
  state: GameRoomState | null,
  events: MatchEventRow[],
  audienceCount: number | undefined,
) {
  const status = state?.status;
  const matchId = state?.matchId ?? null;
  const pausedFor = state?.pausedForPlayerId ?? null;
  const pausedAt = state?.pausedAt ?? null;
  // The newest state for the effects below, which run only when the status
  // or match changes. Declared first, so it updates before they read it.
  const latest = useRef({ state, audienceCount });
  useEffect(() => {
    latest.current = { state, audienceCount };
  });

  useEffect(() => {
    const current = latest.current.state;
    if (!current || !matchId) return;
    const params = partyParams(current, latest.current.audienceCount);
    if (status === "in_game") {
      track("party_game_started", params, { once: `party_game_started:${matchId}` });
      return;
    }
    if (status !== "summary" && status !== "abandoned") return;
    const started = sentRecord(`party_game_started:${matchId}`);
    if (!started || !claimOnce(`party_game_done:${matchId}`)) return;
    const duration_seconds = Math.round((Date.now() - started.at) / 1000);
    track(status === "summary" ? "party_game_completed" : "party_game_abandoned", { ...params, duration_seconds });
  }, [status, matchId]);

  // A phone dropped: the table waits up to two minutes for it.
  const openPause = useRef<string | null>(null);
  useEffect(() => {
    if (!matchId || !pausedFor || !pausedAt) return;
    const key = `${matchId}:${pausedAt}`;
    openPause.current = key;
    track("party_table_paused", {}, { once: `party_table_paused:${key}` });
  }, [matchId, pausedFor, pausedAt]);

  // How the wait ended, from the match_resumed event that closed it.
  useEffect(() => {
    const key = openPause.current;
    if (!key || pausedFor) return;
    const since = Date.parse(key.slice(key.indexOf(":") + 1));
    const resumed = [...events]
      .reverse()
      .find((e) => e.event_type === "match_resumed" && Date.parse(e.created_at) >= since - 1000);
    if (!resumed) return; // The event log catches up with the next snapshot.
    openPause.current = null;
    const reason = resumed.payload?.reason;
    const outcome =
      reason === "reconnected" ? "reconnected" : reason === "computer_took_over" ? "computer_took_over" : "carried_on";
    track("party_pause_ended", { outcome }, { once: `party_pause_ended:${key}` });
  }, [pausedFor, events]);
}
