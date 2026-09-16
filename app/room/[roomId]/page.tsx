"use client";

import { use } from "react";
import { useRoomConnection } from "@/lib/hooks/useRoomConnection";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useRoomStore } from "@/lib/store/room-store";
import { RoomLobby } from "@/components/lobby/RoomLobby";
import { MatchArena } from "@/components/arena/MatchArena";

export default function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
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
