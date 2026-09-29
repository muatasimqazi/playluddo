"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import {
  audienceReact,
  getAudienceState,
  getPartyExtras,
  predictWinner,
  RpcError,
  voteMoment,
  type PartyExtras,
} from "@/lib/supabase/rpc";
import { subscribeToRoom } from "@/lib/realtime/room-channel";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { hapticTap } from "@/lib/hooks/useCoarsePointer";
import { COLORS } from "@/lib/presentation/board";
import { describeMoment, picksFor } from "@/lib/presentation/party";
import type { GameRoomState } from "@/lib/board/types";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { TableLoading } from "@/components/simulator/TableLoading";
import { RoomNotice } from "@/components/lobby/RoomNotice";
import { Reactions } from "@/components/controller/PartyController";
import "@/components/simulator/simulator.css";

/**
 * A Party Mode audience phone (docs/COMPETITIVE_ROADMAP.md Section 6, P6):
 * pick a winner before the start, react on the screen during the game,
 * and vote for the moment of the match at the end. The audience never
 * affects the rules or the dice.
 */
export function AudienceView({ roomId }: { roomId: string }) {
  const client = useMemo(() => createClient(), []);
  const [state, setState] = useState<GameRoomState | null>(null);
  const [extras, setExtras] = useState<PartyExtras | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  useWakeLock();

  const loadExtras = useCallback(
    () =>
      void getPartyExtras(client, roomId)
        .then(setExtras)
        .catch(() => {}),
    [client, roomId],
  );

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof subscribeToRoom> | null = null;
    const receive = (next: GameRoomState) =>
      setState((current) => (current && current.eventSequence > next.eventSequence ? current : next));
    const refresh = () =>
      getAudienceState(client, roomId)
        .then((next) => {
          if (!cancelled) receive(next);
        })
        .catch((e: unknown) => {
          if (!cancelled) setLoadError(e instanceof RpcError ? e.code : "UNKNOWN");
        });
    ensureSession(client)
      .then(() => {
        if (cancelled) return;
        channel = subscribeToRoom(client, roomId, receive, {
          onStatus: (status) => {
            setConnected(status === "SUBSCRIBED");
            if (status === "SUBSCRIBED") {
              void refresh();
              loadExtras();
            }
          },
          onPartyExtras: loadExtras,
        });
        void refresh();
      })
      .catch(() => {
        if (!cancelled) setLoadError("UNKNOWN");
      });
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [client, roomId, loadExtras]);

  // Picks lock in at the start, and the moments arrive at the end.
  const status = state?.status;
  useEffect(() => {
    if (status) loadExtras();
  }, [status, loadExtras]);

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    hapticTap(10);
    try {
      await fn();
      loadExtras();
    } catch (e) {
      // Codes mean a picking window closed; a plain message is the one-a-second limit.
      setActionError(
        e instanceof RpcError && e.code === "UNKNOWN" ? e.message : "That didn't go through. Try again.",
      );
    }
  }

  if (loadError) return <RoomNotice code={loadError === "NOT_AUDIENCE" ? "ROOM_NOT_FOUND" : loadError} />;
  if (!state || !extras) return <TableLoading label="Finding your seat in the audience…" />;
  return (
    <AudienceScreen
      state={state}
      extras={extras}
      connected={connected}
      error={actionError}
      onPredict={(playerId) => void act(() => predictWinner(client, roomId, playerId))}
      onVote={(sequence) => void act(() => voteMoment(client, roomId, sequence))}
      onReact={(text) => audienceReact(client, roomId, text)}
    />
  );
}

/** What an audience phone shows, from the room state and the audience extras. */
export function AudienceScreen({
  state,
  extras,
  connected,
  error: actionError,
  onPredict,
  onVote,
  onReact,
}: {
  state: GameRoomState;
  extras: PartyExtras;
  connected: boolean;
  error: string | null;
  onPredict: (playerId: string) => void;
  onVote: (sequence: number) => void;
  onReact: (text: string) => Promise<unknown>;
}) {

  const winner = state.players.find((p) => p.id === state.winnerIds[0]);
  const turn = state.players.find((p) => p.id === state.turnPlayerId);
  const picked = state.players.find((p) => p.id === extras.lockedPrediction);

  return (
    <main className="party-pad party-audience">
      <header className="party-pad-header">
        <div>
          <strong>In the audience</strong>
          <small>
            Party table {state.code} · {extras.audience.length} watching
          </small>
        </div>
      </header>
      {!connected && (
        <p className="party-pad-banner" role="status">
          Reconnecting…
        </p>
      )}
      {actionError && (
        <p className="party-pad-banner is-error" role="alert">
          {actionError}
        </p>
      )}

      {state.status === "lobby" && (
        <section className="party-pad-status" aria-labelledby="pick-heading">
          <h1 id="pick-heading">Who&rsquo;ll win?</h1>
          <p>Pick before the game starts. Just for bragging rights.</p>
          <ul className="party-audience-choices">
            {state.players.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  className={`party-pad-piece party-audience-choice${extras.myPrediction === player.id ? " is-selected" : ""}`}
                  style={{ "--seat": COLORS[player.color] } as CSSProperties}
                  aria-pressed={extras.myPrediction === player.id}
                  onClick={() => onPredict(player.id)}
                >
                  <PlayerAvatar player={player} size={36} />
                  <span className="party-pad-piece-name">{player.displayName}</span>
                  <small>{plural(picksFor(extras, player.id), "pick")}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.status === "in_game" && (
        <section className="party-pad-status" aria-live="polite">
          <h1>{state.paused ? "The game is paused" : turn ? `${turn.displayName}'s turn` : "Watch the screen"}</h1>
          <p>{picked ? `Your pick: ${picked.displayName}` : "Watch the screen, and cheer them on."}</p>
        </section>
      )}

      {state.status === "summary" && (
        <>
          <section className="party-pad-status" aria-live="polite">
            <h1>{winner ? `${winner.displayName} wins!` : "Game over"}</h1>
            {picked && (
              <p>{picked.id === winner?.id ? "You called it!" : `Not this time. You picked ${picked.displayName}.`}</p>
            )}
          </section>
          {extras.moments.length > 0 && (
            <section className="party-pad-pieces" aria-labelledby="moment-heading">
              <h2 id="moment-heading" className="party-audience-heading">
                Moment of the match
              </h2>
              <ul>
                {extras.moments.map((moment) => {
                  const votes = extras.votes.find((v) => v.sequence === moment.sequence)?.count ?? 0;
                  const mine = extras.myVote === moment.sequence;
                  return (
                    <li key={moment.sequence}>
                      <button
                        type="button"
                        className={`party-pad-piece is-legal${mine ? " is-selected" : ""}`}
                        aria-pressed={mine}
                        onClick={() => onVote(moment.sequence)}
                      >
                        <span className="party-pad-piece-name">{describeMoment(moment, state.players)}</span>
                        <small>{plural(votes, "vote")}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {state.status === "abandoned" && (
        <section className="party-pad-status">
          <h1>The game ended early</h1>
        </section>
      )}

      {state.status !== "abandoned" && (
        <Reactions onReact={onReact} disabled={!connected} />
      )}
    </main>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
