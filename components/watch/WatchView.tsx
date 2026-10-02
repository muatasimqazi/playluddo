"use client";

import { useT } from "@/lib/i18n";


import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useProgressRouter } from "@/lib/navigation/progress";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GameRoomState } from "@/lib/board/types";
import type { MatchEventRow, AudienceReaction } from "@/lib/realtime/room-channel";
import { subscribeToRoom, fetchRecentEvents } from "@/lib/realtime/room-channel";
import { stopAnalyticsForChild, track } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { joinWatch, leaveWatch, getWatchState, watcherReact } from "@/lib/supabase/watch";
import { REACTION_EMOJI_ROWS, isPhrase } from "@/lib/realtime/reactions";
import { Icon } from "@/components/simulator/Icon";
import { TableLoading } from "@/components/simulator/TableLoading";
import "@/components/simulator/simulator.css";

const Simulator = dynamic(() => import("@/components/simulator/Simulator"), {
  ssr: false,
  loading: () => <TableLoading label="Joining the table…" />,
});

type Phase = "loading" | "watching" | "ended" | "error";

export function WatchView({ roomId }: { roomId: string }) {
  const tx = useT();
  const client = useMemo(() => createClient(), []);
  const router = useProgressRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [state, setState] = useState<GameRoomState | null>(null);
  const [events, setEvents] = useState<MatchEventRow[]>([]);
  const [cheers, setCheers] = useState<AudienceReaction[]>([]);
  const nameRef = useRef<string>(tx("watching.watcher"));

  const cheer = (reaction: AudienceReaction) => {
    setCheers((all) => [...all.slice(-5), reaction]);
    setTimeout(() => setCheers((all) => all.filter((r) => r.id !== reaction.id)), 5000);
  };

  useEffect(() => {
    const c = createClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    async function loadEvents() {
      try {
        const next = await fetchRecentEvents(c, roomId);
        if (!cancelled)
          setEvents((cur) =>
            (cur.at(-1)?.sequence ?? -1) > (next.at(-1)?.sequence ?? -1) ? cur : next,
          );
      } catch {
        // The board catches up from the next snapshot.
      }
    }

    async function start() {
      try {
        await ensureSession(c);
        const { data } = await c.auth.getUser();
        nameRef.current =
          (data.user?.user_metadata?.display_name as string) || tx("watching.watcher");
        const { watchTopic } = await joinWatch(c, roomId, nameRef.current);
        if (cancelled) return;
        track("watch_started", {});

        const receive = (next: GameRoomState) => {
          setState((cur) => (cur && cur.eventSequence > next.eventSequence ? cur : next));
          if (next.status !== "lobby") void loadEvents();
        };

        channel = subscribeToRoom(c, roomId, receive, {
          audienceTopic: watchTopic,
          onStatus: (status) => {
            if (status === "SUBSCRIBED") void getWatchState(c, roomId).then(receive).catch(() => {});
          },
          onWatcherReaction: cheer,
          onWatchingEnded: () => {
            if (!cancelled) setPhase("ended");
          },
        });
        const first = await getWatchState(c, roomId);
        if (!cancelled) {
          receive(first);
          setPhase("watching");
        }
      } catch (err) {
        if (cancelled) return;
        const text = err instanceof Error ? err.message : "Could not join.";
        // An under-13 account: no analytics from here on (docs/analytics.md).
        if (text.includes("AGE_RESTRICTED")) stopAnalyticsForChild();
        setMessage(
          text.includes("WATCHING_OFF")
            ? tx("watching.closed")
            : text.includes("AGE_RESTRICTED")
              ? tx("watching.minimumAge")
              : text.includes("AGE_REQUIRED")
                ? tx("watching.ageRequired")
                : text.includes("ALREADY_SEATED")
                  ? tx("watching.alreadySeated")
                  : tx("watching.unavailable"),
        );
        setPhase("error");
      }
    }
    void start();
    return () => {
      cancelled = true;
      void leaveWatch(c, roomId).catch(() => {});
      if (channel) void c.removeChannel(channel);
    };
    // `tx` is only read in error branches; excluding it keeps a language change
    // from re-joining the table. Existing error text stays until the next join.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (phase === "loading") return <TableLoading label={tx("watching.joining")} />;

  if (phase === "error" || phase === "ended")
    return (
      <div className="replay-message" role="alert">
        <p>
          {phase === "ended"
            ? tx("watching.ended")
            : message ?? tx("watching.unavailable")}
        </p>
        <Link href="/" className="sim-primary">
          {tx("actions.backHome")}</Link>
      </div>
    );

  if (!state) return <TableLoading label={tx("watching.joining")} />;

  return (
    <main className="simulator watch-simulator">
      <Simulator
        state={state}
        events={events}
        myPlayerId={null}
        readOnly
        screen
        onRoll={() => {}}
        onMove={() => {}}
      />

      <header className="replay-top">
        <button
          type="button"
          className="replay-exit"
          aria-label={tx("watching.stop")}
          onClick={() => {
            void leaveWatch(client, roomId).catch(() => {});
            router.push("/");
          }}
        >
          <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
        </button>
        <span className="replay-tag">
          <Icon name="look" size={13} /> {tx("watching.label")}</span>
      </header>

      <div className="watch-reactions" aria-label={tx("watching.sendReaction")}>
        {REACTION_EMOJI_ROWS[0].map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => void watcherReact(client, roomId, emoji).catch(() => {})}
          >
            {emoji}
          </button>
        ))}
      </div>

      {cheers.length > 0 && (
        <ul className="party-cheers" aria-label={tx("watching.reactions")}>
          {cheers.map((c) => (
            <li key={c.id} className={isPhrase(c.text) ? "is-phrase" : ""}>
              <span>{c.text}</span>
              <small>{c.name}</small>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
