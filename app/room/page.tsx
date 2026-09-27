"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRoomConnection } from "@/lib/hooks/useRoomConnection";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useRoomStore } from "@/lib/store/room-store";
import { RoomLobby } from "@/components/lobby/RoomLobby";
import { MatchArena } from "@/components/arena/MatchArena";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";
import { TableLoading } from "@/components/simulator/TableLoading";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

// A query param, not a [roomId] path segment: `output: "export"` (the
// Capacitor build, see next.config.ts) can't pre-render a dynamic path
// segment for runtime-generated UUIDs, but a query param needs no
// pre-rendering at all. useSearchParams() requires a Suspense boundary.
export default function RoomPage() {
  // Covers a shared room link opened cold, with no prior visit to the
  // entrance page to have warmed this already — fires immediately (not
  // gated on lobby/in-game status) so it races the "Connecting…" wait
  // instead of the scene's own mount.
  usePreloadBoardScene();
  return (
    <Suspense fallback={<TableLoading label="Joining the table…" />}>
      <RoomPageContent />
    </Suspense>
  );
}

function RoomPageContent() {
  const roomId = useSearchParams().get("id");
  if (!roomId) return <RoomNotice code="ROOM_NOT_FOUND" />;
  return <ConnectedRoom roomId={roomId} />;
}

function ConnectedRoom({ roomId }: { roomId: string }) {
  const { client, loading, error } = useRoomConnection(roomId);
  const roomState = useRoomStore((s) => s.roomState);
  // Instantiated once here (not inside RoomLobby/MatchArena) so a call
  // survives the lobby -> in-game -> summary transition, all one roomId.
  const voice = useVoiceChat(client, roomId);

  if (loading) return <TableLoading label="Joining the table…" />;
  if (error) return <RoomNotice code={error.message} />;
  if (!roomState) return <RoomNotice code="ROOM_NOT_FOUND" />;

  switch (roomState.status) {
    case "lobby":
      return <RoomLobby client={client} roomId={roomId} voice={voice} />;
    case "in_game":
      return <MatchArena client={client} roomId={roomId} voice={voice} />;
    case "summary":
    case "abandoned":
      return <MatchArena client={client} roomId={roomId} voice={voice} />;
    default:
      return null;
  }
}

// Room errors arrive as the server's RPC error codes; say what happened in
// the app's own voice instead of showing "ROOM_NOT_FOUND" on a blank page.
const NOTICES: Record<string, { title: [string, string]; body: string }> = {
  ROOM_NOT_FOUND: {
    title: ["This table has", "cleared."],
    body: "The link may be old or mistyped, or the game has already finished.",
  },
  ROOM_FULL: {
    title: ["Every seat is", "taken."],
    body: "This table is already full. Start a new one, or try a quick match.",
  },
  ALREADY_STARTED: {
    title: ["The game has", "started."],
    body: "This table is mid-game and isn't taking new players.",
  },
  UNAUTHENTICATED: {
    title: ["Let's get you", "seated."],
    body: "We couldn't sign you in to this table. Head back and try the link again.",
  },
};

function RoomNotice({ code }: { code: string }) {
  const notice = NOTICES[code] ?? {
    title: ["Couldn't reach", "the table."] as [string, string],
    body: "Check your connection and try the link again.",
  };
  return (
    <main className="sim-entrance">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content room-notice" role="alert">
        <span className="eyebrow">LUDDO HOUSE</span>
        <h1>
          {notice.title[0]}
          <br />
          <em>{notice.title[1]}</em>
        </h1>
        <p>{notice.body}</p>
        <Link className="sim-primary" href="/">
          <span>Back to the apartment</span>
          <Icon name="arrow" />
        </Link>
      </section>
    </main>
  );
}
