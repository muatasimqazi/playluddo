"use client";

import { Suspense, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useRoomConnection } from "@/lib/hooks/useRoomConnection";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useRoomStore } from "@/lib/store/room-store";
import { RoomLobby } from "@/components/lobby/RoomLobby";
import { MatchArena } from "@/components/arena/MatchArena";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";
import { TableLoading } from "@/components/simulator/TableLoading";
import { RoomNotice } from "@/components/lobby/RoomNotice";
import { JoinTable } from "@/components/lobby/JoinTable";
import { RpcError } from "@/lib/supabase/rpc";
import { fetchBlockedPlayerIds } from "@/lib/supabase/moderation";
import { acceptTableRules, tableRulesAccepted } from "@/lib/community";
import { TableRules } from "@/components/lobby/TableRules";
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

// localStorage never changes under the page except through acceptTableRules.
const noSubscription = () => () => {};

function RoomPageContent() {
  const roomId = useSearchParams().get("id");
  // Bumped after a friend joins from the link, remounting the connection so
  // it claims the seat they now hold.
  const [attempt, setAttempt] = useState(0);
  const rejoin = useCallback(() => setAttempt((n) => n + 1), []);
  const storedAgreement = useSyncExternalStore(noSubscription, tableRulesAccepted, () => true);
  const [agreed, setAgreed] = useState(false);
  if (!roomId) return <RoomNotice code="ROOM_NOT_FOUND" />;
  // Online tables have chat and voice with people who may be strangers.
  if (!storedAgreement && !agreed)
    return (
      <TableRules
        onAgree={() => {
          acceptTableRules();
          setAgreed(true);
        }}
      />
    );
  return <ConnectedRoom key={attempt} roomId={roomId} onJoined={rejoin} />;
}

function ConnectedRoom({ roomId, onJoined }: { roomId: string; onJoined: () => void }) {
  const { client, loading, error } = useRoomConnection(roomId);
  const roomState = useRoomStore((s) => s.roomState);
  // Instantiated once here (not inside RoomLobby/MatchArena) so a call
  // survives the lobby -> in-game -> summary transition, all one roomId.
  const voice = useVoiceChat(client, roomId);
  const seated = !loading && !error;
  useEffect(() => {
    if (!seated) return;
    const { setBlockedPlayerIds } = useRoomStore.getState();
    void fetchBlockedPlayerIds(client, roomId).then(setBlockedPlayerIds).catch(() => {});
  }, [client, roomId, seated]);

  if (loading) return <TableLoading label="Joining the table…" />;
  // Opened someone else's shared link without a seat yet: invite them in
  // with just a name instead of an error (no sign-in required).
  if (error instanceof RpcError && error.code === "SEAT_NOT_CONTROLLED")
    return <JoinTable roomId={roomId} onJoined={onJoined} />;
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
