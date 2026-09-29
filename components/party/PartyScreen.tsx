"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { createPartyRoom, getPartyScreen, RpcError } from "@/lib/supabase/rpc";
import {
  fetchRecentEvents,
  subscribeToRoom,
  type MatchEventRow,
  type MovePreviewSignal,
} from "@/lib/realtime/room-channel";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { webUrl } from "@/lib/native";
import { BRAND } from "@/lib/brand";
import type { GameRoomState, GameType } from "@/lib/board/types";
import type { TableMessage } from "@/lib/realtime/table-messages";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { TableLoading } from "@/components/simulator/TableLoading";
import { Icon } from "@/components/simulator/Icon";
import { QrCode } from "./QrCode";
import "@/components/simulator/simulator.css";

const Simulator = dynamic(() => import("@/components/simulator/Simulator"), {
  ssr: false,
  loading: () => <TableLoading label="Setting the table…" />,
});

/**
 * Party Mode's shared screen (docs/COMPETITIVE_ROADMAP.md Section 6, P1).
 * Opens a party room, shows its code and a QR code for phones to join, and
 * follows the room live. It never takes a seat: phones do the playing.
 */
export function PartyScreen() {
  const roomId = useSearchParams().get("id");
  useWakeLock();
  return roomId ? <ConnectedScreen key={roomId} roomId={roomId} /> : <StartScreen />;
}

function StartScreen() {
  const router = useRouter();
  const [gameType, setGameType] = useState<GameType>("ludo");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      const room = await createPartyRoom(client, gameType);
      router.replace(`/screen?id=${room.roomId}`);
    } catch {
      setError("Couldn't open a table. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <main className="sim-entrance party-screen">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content party-start" aria-labelledby="party-start-heading">
        <span className="eyebrow">PARTY MODE</span>
        <h1 id="party-start-heading">
          The table on this screen.
          <br />
          <em>Everyone plays from their phone.</em>
        </h1>
        <fieldset className="entrance-player-count">
          <legend>What are we playing?</legend>
          <div>
            {(["ludo", "snakes_and_ladders"] as const).map((game) => (
              <button
                key={game}
                type="button"
                className={gameType === game ? "is-selected" : ""}
                aria-pressed={gameType === game}
                onClick={() => setGameType(game)}
              >
                <strong>{game === "ludo" ? "Ludo" : "Snakes & Ladders"}</strong>
              </button>
            ))}
          </div>
        </fieldset>
        <button type="button" className="sim-primary" disabled={pending} onClick={() => void open()}>
          <span>{pending ? "Opening the table…" : "Open the party table"}</span>
          <Icon name="arrow" />
        </button>
        {error && (
          <p className="party-error" role="alert">
            {error}
          </p>
        )}
        <p className="party-hint">Best on a TV or a laptop everyone can see. No sign-in needed here.</p>
      </section>
    </main>
  );
}

function ConnectedScreen({ roomId }: { roomId: string }) {
  const [state, setState] = useState<GameRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Reactions from the phones (party rooms carry no chat), shown over their seats.
  const [reactions, setReactions] = useState<TableMessage[]>([]);
  // The event log animates each roll and move, as on the phones.
  const [events, setEvents] = useState<MatchEventRow[]>([]);
  const [preview, setPreview] = useState<MovePreviewSignal | null>(null);

  useEffect(() => {
    const client = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof subscribeToRoom> | null = null;
    let loadingEvents = false;
    let loadAgain = false;
    // One read at a time; a state that arrives meanwhile reads once more after.
    async function loadEvents() {
      if (loadingEvents) {
        loadAgain = true;
        return;
      }
      loadingEvents = true;
      try {
        do {
          loadAgain = false;
          const next = await fetchRecentEvents(client, roomId);
          if (!cancelled)
            setEvents((current) =>
              (current.at(-1)?.sequence ?? -1) > (next.at(-1)?.sequence ?? -1) ? current : next,
            );
        } while (loadAgain && !cancelled);
      } catch {
        // The table catches up from the next snapshot.
      } finally {
        loadingEvents = false;
      }
    }
    const receive = (next: GameRoomState) => {
      setState((current) =>
        current && current.eventSequence > next.eventSequence ? current : next,
      );
      if (next.status !== "lobby") void loadEvents();
    };
    // Snapshots are authoritative; broadcasts keep them live in between.
    const refresh = () =>
      getPartyScreen(client, roomId)
        .then((next) => {
          if (!cancelled) receive(next);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof RpcError ? e.code : "UNKNOWN");
        });
    ensureSession(client)
      .then(() => {
        if (cancelled) return;
        channel = subscribeToRoom(client, roomId, receive, {
          onStatus: (status) => {
            if (status === "SUBSCRIBED") void refresh();
          },
          onMovePreview: setPreview,
          onMessage: (message) => {
            if (message.kind === "reaction") setReactions((all) => [...all.slice(-19), message]);
          },
        });
        void refresh();
      })
      .catch(() => {
        if (!cancelled) setError("UNKNOWN");
      });
    return () => {
      cancelled = true;
      if (channel) void client.removeChannel(channel);
    };
  }, [roomId]);

  if (error)
    return (
      <main className="sim-entrance party-screen">
        {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
        <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
        <div className="entrance-shade" />
        <section className="entrance-content party-start" role="alert">
          <span className="eyebrow">PARTY MODE</span>
          <h1>
            This screen isn&rsquo;t showing
            <br />
            <em>that table.</em>
          </h1>
          <p className="party-hint">
            Only the screen that opened a party table can show it. Open a new one here.
          </p>
          <Link className="sim-primary" href="/screen">
            <span>Open a new party table</span>
            <Icon name="arrow" />
          </Link>
        </section>
      </main>
    );
  if (!state) return <TableLoading label="Finding your table…" />;
  if (state.status === "lobby") return <PartyLobby state={state} roomId={roomId} />;
  // The shared table, watched: no seat, nothing to press.
  return (
    <Simulator
      state={state}
      events={events}
      myPlayerId={null}
      messages={reactions}
      paused={state.paused}
      screen
      previewPawnId={
        preview && preview.eventSequence === state.eventSequence && preview.playerId === state.turnPlayerId
          ? preview.pawnId
          : null
      }
      readOnly
      onRoll={() => {}}
      onMove={() => {}}
    />
  );
}

export function PartyLobby({ state, roomId }: { state: GameRoomState; roomId: string }) {
  const joinUrl = webUrl(`/room?id=${roomId}`);
  const domain = new URL(BRAND.url).host;
  const maxPlayers = state.maxPlayers ?? 4;
  const vip = state.players.find((p) => p.id === state.hostPlayerId);
  return (
    <main className="sim-entrance party-screen">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="party-lobby" aria-labelledby="party-lobby-heading">
        <div className="party-join">
          <span className="eyebrow">
            PARTY TABLE · {state.gameType === "ludo" ? "LUDO" : "SNAKES & LADDERS"}
          </span>
          <h1 id="party-lobby-heading">
            Grab your phone.
            <br />
            <em>Join the table.</em>
          </h1>
          <ol className="party-steps">
            <li>Scan the code with your phone&rsquo;s camera. No app needed.</li>
            <li>
              Or open <strong>{domain}</strong> and join with the code below.
            </li>
            <li>The first to join picks the game and starts it.</li>
          </ol>
          <p className="party-code" aria-label={`Room code ${state.code.split("").join(" ")}`}>
            {state.code}
          </p>
        </div>
        <div className="party-qr">
          <QrCode value={joinUrl} label="QR code to join this table" />
        </div>
        <ul className="party-seats" aria-label="Players at the table">
          {Array.from({ length: maxPlayers }, (_, seat) => {
            const player = state.players.find((p) => p.seatIndex === seat);
            return (
              <li key={seat} className={player ? "is-taken" : ""}>
                {player ? (
                  <>
                    <PlayerAvatar player={player} size={88} crowned={player.id === vip?.id} />
                    <strong>{player.displayName}</strong>
                    <small>
                      {player.id === vip?.id ? "Picks the game · starts it" : player.isBot ? "Computer" : "Ready"}
                    </small>
                  </>
                ) : (
                  <>
                    <span className="party-seat-empty" aria-hidden>
                      +
                    </span>
                    <small>Open seat</small>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <p className="party-status" role="status" aria-live="polite">
          {vip
            ? `Waiting for ${vip.displayName} to start the game…`
            : "Waiting for the first player to join…"}
        </p>
      </section>
    </main>
  );
}
