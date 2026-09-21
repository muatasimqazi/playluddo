"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fillBot,
  setPlayerColor,
  setRoomGame,
  setRoomMaxPlayers,
  startMatch,
} from "@/lib/supabase/rpc";
import { useRoomStore } from "@/lib/store/room-store";
import { COLORS } from "@/lib/presentation/board";
import { createPractice } from "@/lib/presentation/practice";
import { Icon } from "@/components/simulator/Icon";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { TableLoading } from "@/components/simulator/TableLoading";
import type { PlayerColor } from "@/lib/board/types";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import "@/components/simulator/simulator.css";

const Scene = dynamic(() => import("@/components/simulator/SimulatorScene"), {
  ssr: false,
  loading: () => <TableLoading label="Setting the table…" />,
});
const SEAT_COLORS: PlayerColor[] = ["red", "green", "yellow", "blue"];

export function RoomLobby({
  client,
  roomId,
  voice,
}: {
  client: SupabaseClient;
  roomId: string;
  voice?: VoiceChat;
}) {
  const state = useRoomStore((s) => s.roomState);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<
    "code" | "link" | "shared" | null
  >(null);
  const pawns = useMemo(
    () => createPractice(state?.gameType).state.pawns,
    [state?.gameType],
  );
  const occupiedCount = state?.players.length ?? 1;
  if (!state) return null;
  const maxPlayers = state.maxPlayers ?? 4;
  // For 2 players, the seats aren't a fixed {0,1} range — the second seat
  // is whichever base sits diagonally across the board from the first
  // (mirrors the SQL engine's (seat + 2) % 4 pairing). The host is always
  // seated immediately on creation, so their current seat + its diagonal
  // is always exactly the pair that matters for the seats grid/bot-fill.
  const hostSeatIndex =
    state.players.find((p) => p.id === state.hostPlayerId)?.seatIndex ?? 0;
  const relevantSeats: number[] =
    maxPlayers !== 2
      ? Array.from({ length: maxPlayers }, (_, i) => i)
      : hostSeatIndex % 2 === 0
        ? [0, 2]
        : [1, 3];
  // What *I* can pick for my own base: any of the 4 for a 2-player room
  // until someone other than me has actually taken the other seat, then
  // it's locked to that seat's diagonal, same as the server enforces.
  const myChoiceSeats: number[] =
    maxPlayers === 2 && !state.players.some((p) => p.id !== myPlayerId)
      ? [0, 1, 2, 3]
      : relevantSeats;
  const me = state.players.find((player) => player.id === myPlayerId);
  const host = state.hostPlayerId
    ? state.hostPlayerId === myPlayerId
    : state.players.find((p) => p.seatIndex === 0)?.id === myPlayerId;
  async function run(fn: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }
  function showInviteFeedback(value: "code" | "link" | "shared") {
    setInviteFeedback(value);
    setTimeout(() => setInviteFeedback(null), 2000);
  }
  async function copyInvite(value: string, kind: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      showInviteFeedback(kind);
    } catch {
      setError("Could not copy the invite. Select the room code above instead.");
    }
  }
  async function shareInvite() {
    const url = `${window.location.origin}/room?id=${roomId}`;
    if (!navigator.share) {
      await copyInvite(url, "link");
      return;
    }
    try {
      await navigator.share({
        title: "Join my Luddo table",
        text: `Join my Luddo table with room code ${state!.code}.`,
        url,
      });
      showInviteFeedback("shared");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("Could not open sharing. Copy the room link instead.");
    }
  }
  return (
    <main className="sim-entrance">
      <Scene
        gameType={state.gameType}
        frame={{
          pawns,
          dice: 1,
          rollId: 0,
          actorId: null,
          busy: false,
          replaying: false,
          phase: "idle",
          move: null,
          canReplay: false,
          revision: 0,
        }}
        players={state.players}
        myPlayerId={myPlayerId}
        turnPlayerId={null}
        legalPawnIds={[]}
        canRoll={false}
        view="table"
        mode="play"
        orientation={0}
        quality="medium"
        actionCamera="off"
        resetKey={0}
        onRotate={() => {}}
        onRoll={() => {}}
        onMove={() => {}}
        preview
      />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            LUDDO<small>Let’s Play</small>
          </span>
        </Link>
        <span>THE EVENING IS JUST BEGINNING.</span>
      </header>
      <section className="entrance-content room-lobby">
        <span className="eyebrow">YOUR PRIVATE TABLE</span>
        <h1>
          Good company.
          <br />
          <em>Great game.</em>
        </h1>
        <p>
          Share your room code and bring everyone together. There’s a seat
          waiting.
        </p>
        <div className="lobby-code">
          <div>
            <span className="eyebrow">INVITE YOUR FRIENDS</span>
            <strong>{state.code}</strong>
          </div>
          <div className="lobby-invite-actions">
            <button onClick={() => void shareInvite()} title="Share room invite">
              <Icon name={inviteFeedback === "shared" ? "check" : "share"} />
              {inviteFeedback === "shared" ? "Shared" : "Share"}
            </button>
            <button
              onClick={() => void copyInvite(`${window.location.origin}/room?id=${roomId}`, "link")}
              title="Copy room link"
            >
              <Icon name={inviteFeedback === "link" ? "check" : "link"} />
              {inviteFeedback === "link" ? "Copied" : "Link"}
            </button>
            <button onClick={() => void copyInvite(state.code, "code")} title="Copy room code">
              <Icon name={inviteFeedback === "code" ? "check" : "copy"} />
              {inviteFeedback === "code" ? "Copied" : "Code"}
            </button>
          </div>
        </div>
        <div className="lobby-game">
          <div>
            <span className="eyebrow">ON THE TABLE</span>
            <strong>
              {state.gameType === "ludo" ? "Luddo" : "Snakes & Ladders"}
            </strong>
          </div>
          {host ? (
            <button
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  const next = await setRoomGame(
                    client,
                    roomId,
                    state.gameType === "ludo" ? "snakes_and_ladders" : "ludo",
                  );
                  useRoomStore.getState().setRoomState(next);
                })
              }
            >
              <Icon name="rotate" /> Flip board
            </button>
          ) : (
            <small>The host chooses the board</small>
          )}
        </div>
        <p className="lobby-game-rules">
          {state.gameType === "ludo"
            ? "Four pieces each. Bring your color home."
            : "One piece each. Climb ladders, slide down snakes. Reach 100 with an exact roll."}
        </p>
        {me && !me.isBot && (
          <div className="lobby-color-choice">
            <span>
              <span className="eyebrow">YOUR BASE</span>
              <strong>Choose your color</strong>
            </span>
            <div>
              {myChoiceSeats.map((seat) => {
                const color = SEAT_COLORS[seat];
                const occupant = state.players.find(
                  (player) => player.color === color,
                );
                const selected = me.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    className={selected ? "is-selected" : ""}
                    disabled={pending || (!!occupant && !selected)}
                    aria-label={
                      occupant && !selected
                        ? `${color} base taken by ${occupant.displayName}`
                        : `Choose ${color} base`
                    }
                    aria-pressed={selected}
                    title={
                      occupant && !selected
                        ? `Taken by ${occupant.displayName}`
                        : `${color} base`
                    }
                    onClick={() =>
                      void run(async () => {
                        const next = await setPlayerColor(client, roomId, color);
                        useRoomStore.getState().setRoomState(next);
                      })
                    }
                  >
                    <i style={{ background: COLORS[color] }} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {host && (
          <label className="lobby-player-count">
            <span>
              <span className="eyebrow">TABLE SIZE</span>
              <strong>How many players?</strong>
              <small>Empty selected seats become computers</small>
            </span>
            <select
              value={maxPlayers}
              disabled={pending}
              onChange={(event) =>
                void run(async () => {
                  const next = await setRoomMaxPlayers(
                    client,
                    roomId,
                    Number(event.target.value),
                  );
                  useRoomStore.getState().setRoomState(next);
                })
              }
            >
              {[2, 3, 4].map((count) => (
                <option key={count} value={count} disabled={count < occupiedCount}>
                  {count} players
                </option>
              ))}
            </select>
          </label>
        )}
        {voice && (
          <div className="lobby-voice">
            <button
              className={voice.joined ? "is-active" : ""}
              disabled={voice.connecting}
              onClick={() => (voice.joined ? voice.toggleMute() : voice.join())}
            >
              <Icon name={voice.joined && !voice.muted ? "mic" : "mic-off"} />
              {voice.connecting
                ? "Joining…"
                : voice.joined
                  ? voice.muted
                    ? "Unmute"
                    : "Mute"
                  : "Join audio"}
            </button>
            {voice.joined && (
              <button className="leave-voice" onClick={voice.leave}>
                <Icon name="phone-off" />
                Leave audio
              </button>
            )}
            {voice.error && (
              <span className="lobby-voice-error">{voice.error}</span>
            )}
          </div>
        )}
        <div className="lobby-seats">
          {relevantSeats.map((seat) => {
            const color = SEAT_COLORS[seat];
            const player = state.players.find((p) => p.seatIndex === seat);
            return (
              <div
                key={color}
                className={`lobby-seat ${player ? "occupied" : ""}`}
              >
                {player ? (
                  <PlayerAvatar player={player} size={44} className="lobby-avatar" />
                ) : (
                  <span className="lobby-avatar" style={{ borderColor: COLORS[color] }}>+</span>
                )}
                <span>
                  <strong>
                    {player
                      ? `${player.displayName}${player.id === myPlayerId ? " · You" : ""}`
                      : "An open seat"}
                  </strong>
                  <small>
                    {player
                      ? player.isBot
                        ? "Computer is ready"
                        : "Ready at the table"
                      : `${color} pieces`}
                  </small>
                </span>
                {!player && host && (
                  <button
                    disabled={pending}
                    onClick={() =>
                      void run(() => fillBot(client, roomId, seat))
                    }
                  >
                    Add computer
                  </button>
                )}
                {player?.inVoice && (
                  <span
                    className={`lobby-seat-mic ${voice?.speakingPlayerIds.has(player.id) ? "speaking" : ""}`}
                  >
                    <Icon name="mic" size={12} />
                  </span>
                )}
                {player && <Icon name="check" size={14} />}
              </div>
            );
          })}
        </div>
        {host ? (
          <button
            className="sim-primary"
            disabled={pending || state.players.length < 2}
            onClick={() =>
              void run(async () => {
                const openSeats = relevantSeats.filter(
                  (seat) => !state.players.some((p) => p.seatIndex === seat),
                );
                const computersNeeded = maxPlayers - state.players.length;
                for (const seat of openSeats.slice(0, computersNeeded))
                  await fillBot(client, roomId, seat);
                await startMatch(client, roomId);
              })
            }
          >
            {pending
              ? "Preparing the table…"
              : state.players.length < 2
                ? "Invite a friend or add a computer"
                : state.players.length < maxPlayers
                  ? `Add ${maxPlayers - state.players.length} computer${maxPlayers - state.players.length === 1 ? "" : "s"} & play`
                  : "Everyone’s here. Let’s play."}
            <Icon name="arrow" />
          </button>
        ) : (
          <p className="lobby-wait">Your host will start the match shortly.</p>
        )}
        {error && (
          <p className="lobby-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <footer className="entrance-footer">
        <Link href="/">← BACK TO THE ENTRANCE</Link>
        <span>
          <i className="connection-dot" />
          {state.players.length} OF {maxPlayers} SEATS TAKEN
        </span>
      </footer>
    </main>
  );
}
