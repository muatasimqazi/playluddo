"use client";

import { useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useRoomStore } from "../store/room-store";
import { getMatchResults } from "../supabase/rpc";
import type { GameRoomState } from "../board/types";
import { claimOnce, sentRecord } from "./dedupe";
import { roomEntry } from "./entry";
import { gameParamsFromState, resultParams, analyticsGameType } from "./gameParams";
import type { GamePhase } from "./events";
import { levelBucket, setUserProperties, track } from "./index";

/**
 * Online game lifecycle, seen from one seated player's device
 * (docs/analytics.md, "Counting rule"): each human reports their own seat
 * once per match, keyed by the match id, so N humans at a table send N
 * `game_completed` events. Mounted once per room (app/room/page.tsx), so it
 * outlives lobby → game → summary → rematch. Effects run on status, match and
 * seat-status changes only, never on every move.
 */

// ---------------------------------------------------------------------------
// Per-match social usage, counted in memory while the table is open.

interface SocialUsage {
  chats: number;
  reactions: number;
  call: boolean;
}
const social = new Map<string, SocialUsage>();
const roomsInCall = new Set<string>();

function usageFor(matchId: string): SocialUsage {
  let usage = social.get(matchId);
  if (!usage) {
    usage = { chats: 0, reactions: 0, call: false };
    social.set(matchId, usage);
  }
  return usage;
}

/** A chat message or reaction this player sent (counted, never its text). */
export function noteTableMessage(kind: "chat" | "reaction") {
  const matchId = useRoomStore.getState().roomState?.matchId;
  const status = useRoomStore.getState().roomState?.status;
  if (!matchId || status !== "in_game") return;
  const usage = usageFor(matchId);
  if (kind === "chat") usage.chats += 1;
  else usage.reactions += 1;
}

/** Joined or left the table's call. `call_joined` is sent once per game. */
export function noteCall(roomId: string, joined: boolean) {
  if (!joined) {
    roomsInCall.delete(roomId);
    return;
  }
  roomsInCall.add(roomId);
  const state = useRoomStore.getState().roomState;
  const matchId = state?.matchId ?? null;
  const playing = !!matchId && state?.status === "in_game";
  if (playing) usageFor(matchId).call = true;
  // Once per game; a call started in the lobby counts for the game that follows.
  const scope = playing ? matchId : `lobby-after-${matchId ?? "none"}`;
  track("call_joined", {}, { once: `call_joined:${roomId}:${scope}` });
}

// ---------------------------------------------------------------------------
// Room bookkeeping kept in sessionStorage, per room, on this device only.

const ROOM_KEY = "luddo-analytics-rooms-v1";
interface RoomNotes {
  /** When this tab first saw the room's lobby (ms). */
  lobbyAt?: number;
  /** The last match this tab saw start in the room: a different next one is a rematch. */
  lastMatch?: string;
}

function readNotes(roomId: string): RoomNotes {
  try {
    const all = JSON.parse(window.sessionStorage.getItem(ROOM_KEY) || "{}") as Record<string, RoomNotes>;
    return all[roomId] ?? {};
  } catch {
    return {};
  }
}

function writeNotes(roomId: string, notes: RoomNotes) {
  try {
    const all = JSON.parse(window.sessionStorage.getItem(ROOM_KEY) || "{}") as Record<string, RoomNotes>;
    all[roomId] = notes;
    window.sessionStorage.setItem(ROOM_KEY, JSON.stringify(all));
  } catch {
    /* Private mode: no lobby wait or rematch tag. */
  }
}

function phaseOf(state: GameRoomState | null): GamePhase {
  if (!state || state.status === "lobby") return "lobby";
  return state.status === "in_game" ? "in_game" : "summary";
}

const startKey = (matchId: string, playerId: string) => `game_started:${matchId}:${playerId}`;
const doneKey = (matchId: string, playerId: string) => `game_done:${matchId}:${playerId}`;

function baseParams(state: GameRoomState, roomId: string) {
  const entry = roomEntry(roomId, !!state.isParty);
  return {
    entry,
    params: gameParamsFromState(state, { game_id: state.matchId ?? "", play_context: entry.play_context }),
  };
}

function seconds(fromMs: number | undefined, now = Date.now()) {
  return typeof fromMs === "number" && now >= fromMs ? Math.round((now - fromMs) / 1000) : undefined;
}

/**
 * Leaving through "Leave and go to the entrance" mid-game. A player whose own
 * place is already decided has finished, so that is a completion (without
 * the match stats, which only exist at the end); otherwise an abandonment.
 */
export function reportLeftTable(roomId: string) {
  const { roomState: state, myPlayerId } = useRoomStore.getState();
  if (!state || !myPlayerId || state.status !== "in_game" || !state.matchId) return;
  const me = state.players.find((p) => p.id === myPlayerId);
  if (!me || me.isBot) return;
  const started = sentRecord(startKey(state.matchId, myPlayerId));
  if (!started || !claimOnce(doneKey(state.matchId, myPlayerId))) return;
  const { params } = baseParams(state, roomId);
  const duration_seconds = seconds(started.at);
  if (state.winnerIds.includes(myPlayerId)) {
    const usage = usageFor(state.matchId);
    track("game_completed", {
      ...params,
      ...resultParams(state, myPlayerId, null),
      duration_seconds,
      seat_taken_over: !!sentRecord(`seat_taken_over:${state.matchId}:${myPlayerId}`),
      used_chat: usage.chats > 0,
      used_call: usage.call || roomsInCall.has(roomId),
      reaction_count: usage.reactions,
    });
  } else {
    track("game_abandoned", { ...params, abandon_reason: "left_table", duration_seconds });
  }
}

export function useOnlineRoomAnalytics(
  roomId: string,
  client: SupabaseClient,
  seated: boolean,
  /** Party Mode: where this player said they're playing from (the seat's flag is set a moment later). */
  wantsRemote: boolean | null = null,
) {
  const status = useRoomStore((s) => s.roomState?.status);
  const matchId = useRoomStore((s) => s.roomState?.matchId ?? null);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const connection = useRoomStore((s) => s.connection);
  const myStatus = useRoomStore((s) => s.roomState?.players.find((p) => p.id === s.myPlayerId)?.status);
  const myIsBot = useRoomStore((s) => s.roomState?.players.find((p) => p.id === s.myPlayerId)?.isBot);
  const myLevel = useRoomStore((s) => s.roomState?.players.find((p) => p.id === s.myPlayerId)?.level);
  const hasSeat = myIsBot === false;

  // Joined the room: once per seat. Also starts the lobby clock.
  useEffect(() => {
    if (!seated || !hasSeat || !myPlayerId) return;
    const state = useRoomStore.getState().roomState;
    if (!state) return;
    const notes = readNotes(roomId);
    if (state.status === "lobby" && !notes.lobbyAt) writeNotes(roomId, { ...notes, lobbyAt: Date.now() });
    const entry = roomEntry(roomId, !!state.isParty);
    const isHost = state.hostPlayerId === myPlayerId;
    track(
      "room_joined",
      {
        play_context: entry.play_context,
        entry_point: entry.entry_point,
        role: isHost ? "host" : "player",
        game_type: analyticsGameType(state.gameType),
      },
      { once: `room_joined:${roomId}:${myPlayerId}` },
    );
    if (state.isParty) {
      const me = state.players.find((p) => p.id === myPlayerId);
      track(
        "party_controller_joined",
        { role: isHost ? "vip" : "player", remote: wantsRemote ?? !!me?.partyRemote },
        { once: `party_controller_joined:${roomId}:${myPlayerId}` },
      );
    }
  }, [roomId, seated, hasSeat, myPlayerId, wantsRemote]);

  // Game started: the first in_game sighting of a new match with a human seat
  // here (quick match and tournament tables arrive already started).
  useEffect(() => {
    if (status !== "in_game" || !matchId || !myPlayerId || !hasSeat) return;
    const state = useRoomStore.getState().roomState;
    if (!state) return;
    const notes = readNotes(roomId);
    const { entry, params } = baseParams(state, roomId);
    const rematch = !!notes.lastMatch && notes.lastMatch !== matchId;
    const me = state.players.find((p) => p.id === myPlayerId);
    const sent = track(
      "game_started",
      {
        ...params,
        entry_point: rematch ? "rematch" : entry.entry_point,
        is_host: state.hostPlayerId === myPlayerId,
        lobby_wait_seconds: rematch || !notes.lobbyAt ? undefined : seconds(notes.lobbyAt),
      },
      { once: startKey(matchId, myPlayerId), onceData: { level: me?.level ?? 0 } },
    );
    if (sent && roomsInCall.has(roomId)) usageFor(matchId).call = true;
    // The lobby wait is measured for a room's first game only; later ones are rematches.
    if (notes.lastMatch !== matchId) writeNotes(roomId, { lobbyAt: notes.lobbyAt, lastMatch: matchId });
  }, [roomId, status, matchId, myPlayerId, hasSeat]);

  // A computer took this seat over (3 missed turns, or away 45 s), and taking it back.
  const previousStatus = useRef(myStatus);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = myStatus;
    if (status !== "in_game" || !matchId || !myPlayerId || !hasSeat) return;
    const state = useRoomStore.getState().roomState;
    const play_context = state ? roomEntry(roomId, !!state.isParty).play_context : "private_room";
    if (myStatus === "bot") {
      const me = state?.players.find((p) => p.id === myPlayerId);
      track(
        "seat_taken_over",
        { reason: (me?.missedDecisionCount ?? 0) >= 3 ? "timeouts" : "disconnect", play_context },
        { once: `seat_taken_over:${matchId}:${myPlayerId}` },
      );
    } else if (previous === "bot" && myStatus === "connected") {
      track("seat_reclaimed", { play_context }, { once: `seat_reclaimed:${matchId}:${myPlayerId}` });
    }
  }, [roomId, status, matchId, myPlayerId, hasSeat, myStatus]);

  // The match ended: completed (with this seat's results) or abandoned.
  useEffect(() => {
    if ((status !== "summary" && status !== "abandoned") || !matchId || !myPlayerId || !hasSeat) return;
    const started = sentRecord(startKey(matchId, myPlayerId));
    // Only a device that saw the start reports the end, so completion rates stay per start.
    if (!started || sentRecord(doneKey(matchId, myPlayerId))) return;
    const state = useRoomStore.getState().roomState;
    if (!state) return;
    const { params } = baseParams(state, roomId);
    if (status === "abandoned") {
      if (claimOnce(doneKey(matchId, myPlayerId)))
        track("game_abandoned", { ...params, abandon_reason: "match_abandoned", duration_seconds: seconds(started.at) });
      return;
    }
    const endedAt = Date.now();
    const playerId = myPlayerId;
    void getMatchResults(client, roomId)
      .catch(() => null)
      .then((results) => {
        if (!claimOnce(doneKey(matchId, playerId))) return;
        const usage = usageFor(matchId);
        const me = state.players.find((p) => p.id === playerId);
        track("game_completed", {
          ...params,
          ...resultParams(state, playerId, results),
          duration_seconds: seconds(started.at, endedAt),
          seat_taken_over: !!sentRecord(`seat_taken_over:${matchId}:${playerId}`) || me?.status === "bot",
          used_chat: usage.chats > 0,
          used_call: usage.call || roomsInCall.has(roomId),
          reaction_count: usage.reactions,
        });
      });
  }, [client, roomId, status, matchId, myPlayerId, hasSeat]);

  // Level-ups arrive with the summary state (the server awards XP as the match ends).
  useEffect(() => {
    if (status !== "summary" || !matchId || !myPlayerId || typeof myLevel !== "number") return;
    const before = sentRecord(startKey(matchId, myPlayerId))?.data?.level;
    if (typeof before === "number" && myLevel > before)
      track("level_up", { level: myLevel }, { once: `level_up:${matchId}:${myPlayerId}` });
    if (myLevel > 1) setUserProperties({ level_bucket: levelBucket(myLevel) });
  }, [status, matchId, myPlayerId, myLevel]);

  // Realtime: an outage that recovers after 3 s or more, or still down after
  // 60 s. A page in the background (a phone locked or switched away) drops
  // its connection on purpose, so an outage it spent hidden isn't counted.
  const downSince = useRef<number | null>(null);
  const wasConnected = useRef(false);
  const hiddenDuringOutage = useRef(false);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && downSince.current !== null) hiddenDuringOutage.current = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (connection === "connected") {
      const since = downSince.current;
      const hidden = hiddenDuringOutage.current;
      downSince.current = null;
      hiddenDuringOutage.current = false;
      wasConnected.current = true;
      if (since !== null && !hidden) {
        const offline = Math.round((Date.now() - since) / 1000);
        if (offline >= 3)
          track("realtime_reconnected", {
            offline_seconds: offline,
            game_phase: phaseOf(useRoomStore.getState().roomState),
          });
      }
      return;
    }
    if (connection !== "reconnecting" || !wasConnected.current || downSince.current !== null) return;
    const since = Date.now();
    downSince.current = since;
    hiddenDuringOutage.current = document.visibilityState === "hidden";
    const timer = setTimeout(() => {
      if (downSince.current === since && !hiddenDuringOutage.current && document.visibilityState !== "hidden")
        track("realtime_reconnect_failed", { game_phase: phaseOf(useRoomStore.getState().roomState) });
    }, 60_000);
    return () => clearTimeout(timer);
  }, [connection]);
}
