"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRoomConnection } from "@/lib/hooks/useRoomConnection";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useRoomStore } from "@/lib/store/room-store";
import { RoomLobby } from "@/components/lobby/RoomLobby";
import { MatchArena } from "@/components/arena/MatchArena";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";

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
    <Suspense fallback={<CenteredMessage>Connecting…</CenteredMessage>}>
      <RoomPageContent />
    </Suspense>
  );
}

function RoomPageContent() {
  const roomId = useSearchParams().get("id");
  if (!roomId) return <CenteredMessage>Room not found.</CenteredMessage>;
  return <ConnectedRoom roomId={roomId} />;
}

function ConnectedRoom({ roomId }: { roomId: string }) {
  const { client, loading, error } = useRoomConnection(roomId);
  const roomState = useRoomStore((s) => s.roomState);
  // Instantiated once here (not inside RoomLobby/MatchArena) so a call
  // survives the lobby -> in-game -> summary transition, all one roomId.
  const voice = useVoiceChat(client, roomId);

  if (loading) return <CenteredMessage>Connecting…</CenteredMessage>;
  if (error) return <CenteredMessage>{error.message}</CenteredMessage>;
  if (!roomState) return <CenteredMessage>Room not found.</CenteredMessage>;

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

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4 text-center text-sm text-text-secondary">
      {children}
    </div>
  );
}
