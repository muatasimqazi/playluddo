"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RpcError,
  getDiceProof,
  getMatchResults,
  getPartyExtras,
  guessPartyRound,
  partyPreviewMove,
  requestMove,
  requestRoll,
  toggleAutoRoll,
  requestRematch,
  acceptRematch,
  reclaimSeat,
  toggleMatchPause,
} from "@/lib/supabase/rpc";
import { useRoomStore } from "@/lib/store/room-store";
import { reportPlayer, setPlayerBlocked } from "@/lib/supabase/moderation";
import { setWatching } from "@/lib/supabase/watch";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import type { MatchResult } from "@/lib/board/types";
import type { PartyRound } from "@/lib/supabase/rpc";
import { rememberCommitment, type DiceProof } from "@/lib/presentation/diceProof";
import { TableLoading } from "@/components/simulator/TableLoading";
import { useAgeCheck } from "@/components/lobby/AgeCheck";
import { PartyController } from "@/components/controller/PartyController";
import type { Cast } from "@/lib/hooks/useCast";
import { usePartyHeartbeat } from "@/lib/hooks/usePartyHeartbeat";
import { errorCode, track, trackError } from "@/lib/analytics";
import type { ErrorArea } from "@/lib/analytics/events";
import { noteTableMessage, reportLeftTable } from "@/lib/analytics/useRoomAnalytics";
// Eagerly loaded here, not just inside the dynamic Simulator below, so the
// loading fallback's own styling (the die animation) is available
// immediately instead of arriving with the same lazy chunk it stands in for.
import "@/components/simulator/simulator.css";

const Simulator = dynamic(() => import("@/components/simulator/Simulator"), {
  ssr: false,
  loading: () => <TableLoading label="Joining the table…" />,
});

export function MatchArena({
  client,
  roomId,
  voice,
  cast,
}: {
  client: SupabaseClient;
  roomId: string;
  voice?: VoiceChat;
  /** Cast to TV, owned by the room page so it outlives lobby -> game. */
  cast?: Cast;
}) {
  const state = useRoomStore((s) => s.roomState);
  const events = useRoomStore((s) => s.events);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const connectionToken = useRoomStore((s) => s.connectionToken);
  const sessionReplaced = useRoomStore((s) => s.sessionReplaced);
  const setSessionReplaced = useRoomStore((s) => s.setSessionReplaced);
  const connection = useRoomStore((s) => s.connection);
  const messages = useRoomStore((s) => s.messages);
  const addMessage = useRoomStore((s) => s.addMessage);
  const blockedPlayerIds = useRoomStore((s) => s.blockedPlayerIds);
  const setBlockedPlayerIds = useRoomStore((s) => s.setBlockedPlayerIds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [diceProof, setDiceProof] = useState<DiceProof | null>(null);
  // The between-game round, once the screen opens it (P8).
  const [round, setRound] = useState<PartyRound | null>(null);
  const extrasVersion = useRoomStore((s) => s.partyExtrasVersion);
  const matchId = state?.matchId;
  const diceCommitment = state?.diceCommitment;
  // Remember the commitment the first time this device sees it, so the
  // after-game check can confirm it never changed.
  useEffect(() => {
    if (matchId && diceCommitment) rememberCommitment(matchId, diceCommitment);
  }, [matchId, diceCommitment]);
  // The between-game round, while the podium is up (P8).
  const isParty = state?.isParty ?? false;
  const roundPhase = state?.status;
  useEffect(() => {
    if (!isParty || roundPhase !== "summary") return;
    let cancelled = false;
    getPartyExtras(client, roomId)
      .then((extras) => {
        if (!cancelled) setRound(extras.round);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, roomId, isParty, roundPhase, extrasVersion]);
  // Rematches and reclaiming a seat check age (docs/COMPETITIVE_ROADMAP.md F0.4).
  const age = useAgeCheck();
  // Party phones keep saying they're here, so a table waits for them if they go (P5).
  usePartyHeartbeat(client, roomId, !!state?.isParty && state.status === "in_game");
  const iAmRemote = !!state?.players.find((p) => p.id === myPlayerId)?.partyRemote;
  const ended = state?.status === "summary" || state?.status === "abandoned";
  // The server records results in the same transaction that ends the match,
  // so they're ready as soon as the ended state arrives. A rematch returns
  // to the lobby, which unmounts this arena, so results never go stale.
  // Without them (an older server) the summary just shows no stats.
  useEffect(() => {
    if (!ended) return;
    let cancelled = false;
    getMatchResults(client, roomId)
      .then((next) => {
        if (!cancelled) setResults(next);
      })
      .catch(() => {});
    getDiceProof(client, roomId)
      .then((next) => {
        if (!cancelled) setDiceProof(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, roomId, ended]);
  async function act(fn: () => Promise<unknown>, area?: ErrorArea) {
    if (pending || sessionReplaced) return;
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (age.handle(e, () => void act(fn, area))) return;
      // Codes only, and only for actions worth counting (not roll/move races).
      if (area) trackError(area, errorCode(e));
      if (e instanceof RpcError && e.code === "SESSION_REPLACED")
        setSessionReplaced();
      else
        setError(
          e instanceof Error ? e.message : "The action could not be completed.",
        );
    } finally {
      setPending(false);
    }
  }
  if (!state) return null;
  async function sendMessage(text: string, kind: "chat" | "reaction") {
    const { data, error } = await client.rpc("send_table_message", {
      p_room_id: roomId,
      p_text: text,
      p_kind: kind,
    });
    if (error)
      throw new Error(
        error.code === "PGRST202"
          ? "Table chat needs the latest database migration."
          : error.message,
      );
    addMessage(data);
    noteTableMessage(kind);
  }
  const onRoll = () => act(() => requestRoll(client, roomId, connectionToken));
  const onMove = (id: string) =>
    act(() => requestMove(client, roomId, id, connectionToken));
  const onRematch = () =>
    act(async () => {
      const accepting = state.players.some((p) => p.rematchReady);
      await (accepting ? acceptRematch(client, roomId) : requestRematch(client, roomId));
      track("rematch_requested", { role: accepting ? "accepter" : "proposer" });
    }, "rematch");
  const onReclaim = () => act(() => reclaimSeat(client, roomId), "reclaim");
  const onAutoRoll = (enabled: boolean) =>
    act(() => toggleAutoRoll(client, roomId, enabled));
  const onPause = (paused: boolean) =>
    act(async () => {
      const next = await toggleMatchPause(client, roomId, paused);
      useRoomStore.getState().setRoomState(next);
    });
  const mySeat = state.players.find((p) => p.id === myPlayerId);
  const livingRoom = state.isParty && !mySeat?.partyRemote;
  // Party Mode: the table is on the shared screen; this phone is a controller.
  if (livingRoom)
    return (
      <>
        {age.gate}
        <PartyController
          state={state}
          myPlayerId={myPlayerId}
          pending={pending}
          error={error}
          connection={connection}
          sessionReplaced={sessionReplaced}
          onRoll={() => void onRoll()}
          onMove={(id) => void onMove(id)}
          onReact={(text) => sendMessage(text, "reaction")}
          onReclaim={() => void onReclaim()}
          onRematch={() => void onRematch()}
          onAutoRoll={(enabled) => void onAutoRoll(enabled)}
          onPause={(paused) => void onPause(paused)}
          // Best effort: the move itself doesn't depend on it.
          onPreview={(pawnId) => void partyPreviewMove(client, roomId, pawnId).catch(() => {})}
          round={roundPhase === "summary" ? round : null}
          onGuess={(guess) => guessPartyRound(client, roomId, guess)}
          cast={cast}
        />
      </>
    );
  return (
    <>
      {age.gate}
      <Simulator
        state={state}
        events={events}
        myPlayerId={myPlayerId}
        pending={pending}
        error={error}
        readOnly={sessionReplaced}
        connection={connection}
        messages={messages}
        onMessage={sendMessage}
        onRoll={onRoll}
        onMove={onMove}
        onRematch={onRematch}
        onReclaim={onReclaim}
        onLeaveTable={() => reportLeftTable(roomId)}
        onAutoRoll={onAutoRoll}
        paused={state.paused}
        canPause={state.hostPlayerId === myPlayerId}
        onPause={onPause}
        onSetWatching={
          state.isParty ? undefined : (enabled) => setWatching(client, roomId, enabled)
        }
        voice={!state.isParty || iAmRemote ? voice : undefined}
        cast={cast}
        matchResults={ended ? results : null}
        diceProof={ended ? diceProof : null}
        blockedPlayerIds={blockedPlayerIds}
        onBlockPlayer={async (playerId, blocked) => {
          await setPlayerBlocked(client, roomId, playerId, blocked);
          const current = useRoomStore.getState().blockedPlayerIds;
          setBlockedPlayerIds(
            blocked ? [...new Set([...current, playerId])] : current.filter((id) => id !== playerId),
          );
        }}
        onReportPlayer={(playerId, reason, details) =>
          reportPlayer(client, roomId, playerId, reason, details)
        }
      />
    </>
  );
}
