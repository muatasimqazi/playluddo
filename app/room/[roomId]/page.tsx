"use client";

import { use } from "react";
import { useRoomConnection } from "@/lib/hooks/useRoomConnection";
import { useRoomStore } from "@/lib/store/room-store";
import { RoomLobby } from "@/components/lobby/RoomLobby";
import { MatchArena } from "@/components/arena/MatchArena";
import { MatchSummary } from "@/components/summary/MatchSummary";

export default function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const { client, loading, error } = useRoomConnection(roomId);
  const roomState = useRoomStore((s) => s.roomState);

  if (loading) return <CenteredMessage>Connecting…</CenteredMessage>;
  if (error) return <CenteredMessage>{error.message}</CenteredMessage>;
  if (!roomState) return <CenteredMessage>Room not found.</CenteredMessage>;

  switch (roomState.status) {
    case "lobby":
      return <RoomLobby client={client} roomId={roomId} />;
    case "in_game":
      return <MatchArena client={client} roomId={roomId} />;
    case "summary":
    case "abandoned":
      return <MatchSummary client={client} roomId={roomId} />;
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
