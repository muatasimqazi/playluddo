"use client";

import { useEffect, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { getCastState } from "@/lib/supabase/rpc";
import { fetchRecentEvents, subscribeToRoom, type MatchEventRow } from "@/lib/realtime/room-channel";
import type { GameRoomState } from "@/lib/board/types";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { TableLoading } from "@/components/simulator/TableLoading";
import { useI18n } from "@/lib/i18n";
import "@/components/simulator/simulator.css";

const Simulator = dynamic(() => import("@/components/simulator/Simulator"), {
  ssr: false,
  loading: () => <TableLoading label="Setting the table…" />,
});

/**
 * An ordinary table cast to a TV (supabase/migrations/20260930150000_cast_to_tv.sql).
 * Like a watcher, the TV hears only its own `cast:<id>` topic, which carries
 * game state and nothing else: no chat, reactions or call signalling. It shows
 * the lobby until the game starts, then the table in the Party screen's
 * steady, sofa-sized view.
 */
export function CastScreen({ roomId, topic }: { roomId: string; topic: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<GameRoomState | null>(null);
  const [events, setEvents] = useState<MatchEventRow[]>([]);

  useEffect(() => {
    const client = createClient();
    let cancelled = false;
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
      if (cancelled) return;
      setState((current) => (current && current.eventSequence > next.eventSequence ? current : next));
      if (next.status !== "lobby") void loadEvents();
    };
    // Snapshots are authoritative; broadcasts keep them live in between.
    const refresh = () => getCastState(client, roomId).then(receive).catch(() => {});
    const channel = subscribeToRoom(client, roomId, receive, {
      audienceTopic: topic,
      onStatus: (status) => {
        if (status === "SUBSCRIBED") void refresh();
      },
    });
    void refresh();
    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [roomId, topic]);

  if (!state) return <TableLoading label={t("party.findingTable")} />;
  if (state.status === "lobby") return <CastLobby state={state} />;
  return (
    <Simulator
      state={state}
      events={events}
      myPlayerId={null}
      paused={state.paused}
      screen
      readOnly
      onRoll={() => {}}
      onMove={() => {}}
    />
  );
}

/** Who's sitting down, on the TV, until the host starts the game. */
function CastLobby({ state }: { state: GameRoomState }) {
  const { t } = useI18n();
  const maxPlayers = state.maxPlayers ?? 4;
  return (
    <main className="sim-entrance party-screen">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="party-lobby" style={{ gridTemplateColumns: "minmax(0, 1fr)" }} aria-labelledby="cast-lobby-heading">
        <div className="party-join">
          <span className="eyebrow">
            {t("cast.tvEyebrow")} · {state.gameType === "ludo" ? t("entrance.ludo").toUpperCase() : t("entrance.snakes").toUpperCase()}
          </span>
          <h1 id="cast-lobby-heading">
            {t("cast.tvWaiting1")}
            <br />
            <em>{t("cast.tvWaitingEm")}</em>
          </h1>
          <p className="party-code">{state.code}</p>
        </div>
        <ul
          className="party-seats"
          style={{ gridTemplateColumns: `repeat(${maxPlayers}, 1fr)` } as CSSProperties}
          aria-label={t("party.playersAtTableAria")}
        >
          {Array.from({ length: maxPlayers }, (_, seat) => {
            const player = state.players.find((p) => p.seatIndex === seat);
            return (
              <li key={seat} className={player ? "is-taken" : ""}>
                {player ? (
                  <>
                    <PlayerAvatar player={player} size={88} crowned={player.id === state.hostPlayerId} />
                    <strong>{player.displayName}</strong>
                    <small>{player.isBot ? t("party.computer") : t("party.ready")}</small>
                  </>
                ) : (
                  <>
                    <span className="party-seat-empty" aria-hidden>
                      +
                    </span>
                    <small>{t("party.openSeat")}</small>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <p className="party-status" role="status" aria-live="polite">
          {t("cast.tvSeats", { taken: state.players.length, max: maxPlayers })}
        </p>
      </section>
    </main>
  );
}
