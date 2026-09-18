"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fillBot, startMatch } from "@/lib/supabase/rpc";
import { useRoomStore } from "@/lib/store/room-store";
import { COLORS } from "@/lib/presentation/board";
import { createPractice } from "@/lib/presentation/practice";
import { Icon } from "@/components/simulator/Icon";
import type { PlayerColor } from "@/lib/board/types";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import "@/components/simulator/simulator.css";

const Scene = dynamic(() => import("@/components/simulator/SimulatorScene"), {
  ssr: false,
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
  const [copied, setCopied] = useState(false);
  const pawns = useMemo(() => createPractice().state.pawns, []);
  if (!state) return null;
  const host = state.players.find((p) => p.seatIndex === 0)?.id === myPlayerId;
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
  async function copy() {
    try {
      await navigator.clipboard.writeText(state!.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy the six-letter code above to invite your friends.");
    }
  }
  return (
    <main className="sim-entrance">
      <Scene
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
            LUDDO<small>Let's Play</small>
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
          <button onClick={() => void copy()} title="Copy room code">
            <Icon name={copied ? "check" : "users"} />
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
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
              <button onClick={voice.leave}>
                <Icon name="phone-off" />
                Leave audio
              </button>
            )}
            {voice.error && <span className="lobby-voice-error">{voice.error}</span>}
          </div>
        )}
        <div className="lobby-seats">
          {SEAT_COLORS.map((color, seat) => {
            const player = state.players.find((p) => p.seatIndex === seat);
            return (
              <div
                key={color}
                className={`lobby-seat ${player ? "occupied" : ""}`}
              >
                <span
                  className="lobby-avatar"
                  style={{
                    background: player ? COLORS[color] : undefined,
                    borderColor: COLORS[color],
                  }}
                >
                  {player ? player.displayName.slice(0, 1) : "+"}
                </span>
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
            onClick={() => void run(() => startMatch(client, roomId))}
          >
            {pending
              ? "Preparing the table…"
              : state.players.length < 2
                ? "Invite a friend or add a computer"
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
          {state.players.length} OF 4 SEATS TAKEN
        </span>
      </footer>
    </main>
  );
}
