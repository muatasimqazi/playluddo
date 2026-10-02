"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRoomConnection } from "@/lib/hooks/useRoomConnection";
import { useVoiceChat } from "@/lib/hooks/useVoiceChat";
import { useCast } from "@/lib/hooks/useCast";
import { useRoomStore } from "@/lib/store/room-store";
import { RoomLobby } from "@/components/lobby/RoomLobby";
import { MatchArena } from "@/components/arena/MatchArena";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";
import { TableLoading } from "@/components/simulator/TableLoading";
import { RoomNotice } from "@/components/lobby/RoomNotice";
import { JoinTable } from "@/components/lobby/JoinTable";
import { getRoomInvite, RpcError, setPartyRemote } from "@/lib/supabase/rpc";
import { fetchBlockedPlayerIds } from "@/lib/supabase/moderation";
import { acceptTableRules, partyRulesAccepted, tableRulesAccepted } from "@/lib/community";
import { TableRules } from "@/components/lobby/TableRules";
import { AgeRequired, UnderAgeNotice } from "@/components/lobby/AgeCheck";
import { PartyAgreement } from "@/components/party/PartyAgreement";
import { PartyWhere } from "@/components/party/PartyWhere";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { AudienceView } from "@/components/party/AudienceView";
import { useOnlineRoomAnalytics } from "@/lib/analytics/useRoomAnalytics";
import { track } from "@/lib/analytics";
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
  return roomId ? <RoomAccess key={roomId} roomId={roomId} /> : <RoomNotice code="ROOM_NOT_FOUND" />;
}

function RoomAccess({ roomId }: { roomId: string }) {
  // Bumped after a friend joins from the link, remounting the connection so
  // it claims the seat they now hold.
  const [attempt, setAttempt] = useState(0);
  const rejoin = useCallback(() => setAttempt((n) => n + 1), []);
  const [kind, setKind] = useState<{ roomId: string; party: boolean; seated: boolean } | null>(null);
  // Mixed party rooms (P8): the living room, or somewhere else.
  const [remote, setRemote] = useState<boolean | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const client = createClient();
    void ensureSession(client).then(() => getRoomInvite(client, roomId)).then((invite) => {
      if (!cancelled) setKind({ roomId, party: !!invite.isParty, seated: invite.isSeated });
    }).catch((e: unknown) => {
      if (!cancelled) setInviteError(e instanceof RpcError ? e.code : "UNKNOWN");
    });
    return () => { cancelled = true; };
  }, [roomId]);
  const [agreed, setAgreed] = useState(false);
  // Party Mode (P6): this phone joined the room's audience rather than a seat.
  const [audience, setAudience] = useState(false);
  const joinedAudience = useCallback(() => setAudience(true), []);
  if (!roomId) return <RoomNotice code="ROOM_NOT_FOUND" />;
  if (inviteError) return <RoomNotice code={inviteError} />;
  if (kind?.roomId !== roomId) return <TableLoading label="Opening your invitation…" />;
  // A player joining from elsewhere has voice, so they get the full table
  // agreement rather than the short Party one (decision 7). Someone who
  // already holds a seat and has agreed once isn't asked again.
  if (kind.party && remote === null && !(kind.seated && (partyRulesAccepted() || tableRulesAccepted())))
    return <PartyWhere onChoose={setRemote} />;
  if (kind.party && !remote && !agreed) return <PartyAgreement onAgree={() => setAgreed(true)} />;
  if (kind.party && remote && !tableRulesAccepted() && !agreed)
    return (
      <TableRules
        onAgree={() => {
          acceptTableRules();
          setAgreed(true);
        }}
      />
    );
  // Short Party acceptance never bypasses an ordinary table's full agreement.
  if (!kind.party && !tableRulesAccepted() && !agreed)
    return (
      <TableRules
        onAgree={() => {
          acceptTableRules();
          setAgreed(true);
        }}
      />
    );
  if (audience) return <AudienceView roomId={roomId} />;
  return (
    <ConnectedRoom
      key={attempt}
      roomId={roomId}
      onJoined={rejoin}
      onAudience={joinedAudience}
      wantsRemote={kind.party ? remote : null}
    />
  );
}

function ConnectedRoom({
  roomId,
  onJoined,
  onAudience,
  wantsRemote,
}: {
  roomId: string;
  onJoined: () => void;
  onAudience: () => void;
  /** Party Mode (P8): where this player said they'd be playing from. */
  wantsRemote: boolean | null;
}) {
  const { client, loading, error } = useRoomConnection(roomId);
  const roomState = useRoomStore((s) => s.roomState);
  // Instantiated once here (not inside RoomLobby/MatchArena) so a call
  // survives the lobby -> in-game -> summary transition, all one roomId.
  const voice = useVoiceChat(client, roomId);
  const seated = !loading && !error;
  // Joins, game lifecycle, seat takeovers and reconnects, once per seat
  // (lib/analytics/useRoomAnalytics.ts). Lives here so it spans lobby → game.
  useOnlineRoomAnalytics(roomId, client, seated, wantsRemote);
  // Likewise the cast, so a TV that's showing keeps its "Stop casting".
  // Only a seat can cast its table.
  const cast = useCast(seated ? roomId : null);
  const casting = cast.connected;
  const isPartyRoom = !!roomState?.isParty;
  useEffect(() => {
    if (casting) track("cast_started", { is_party: isPartyRoom });
    // Reported as the cast connects, not on every later change of room state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting]);
  useEffect(() => {
    if (!seated) return;
    const { setBlockedPlayerIds } = useRoomStore.getState();
    void fetchBlockedPlayerIds(client, roomId).then(setBlockedPlayerIds).catch(() => {});
  }, [client, roomId, seated]);
  // Tell the table where this player is, once they hold a seat. The server
  // only accepts it in the lobby, which is also the only place it's asked.
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const mySeatRemote = roomState?.players.find((p) => p.id === myPlayerId)?.partyRemote;
  const inLobby = roomState?.status === "lobby";
  useEffect(() => {
    if (!seated || !inLobby || wantsRemote === null || mySeatRemote === undefined) return;
    if (mySeatRemote === wantsRemote) return;
    void setPartyRemote(client, roomId, wantsRemote).catch(() => {});
  }, [client, roomId, seated, inLobby, wantsRemote, mySeatRemote]);

  if (loading) return <TableLoading label="Joining the table…" />;
  // Opened someone else's shared link without a seat yet: invite them in
  // with just a name instead of an error (no sign-in required).
  if (error instanceof RpcError && error.code === "SEAT_NOT_CONTROLLED")
    return <JoinTable roomId={roomId} onJoined={onJoined} onAudience={onAudience} />;
  // Returning to a lobby for a new match (docs/COMPETITIVE_ROADMAP.md F0.4).
  if (error instanceof RpcError && error.code === "AGE_REQUIRED") return <AgeRequired onEligible={onJoined} />;
  if (error instanceof RpcError && error.code === "AGE_RESTRICTED") return <UnderAgeNotice />;
  if (error) return <RoomNotice code={error.message} />;
  if (!roomState) return <RoomNotice code="ROOM_NOT_FOUND" />;

  switch (roomState.status) {
    case "lobby":
      return <RoomLobby client={client} roomId={roomId} voice={voice} cast={cast} />;
    case "in_game":
      return <MatchArena client={client} roomId={roomId} voice={voice} cast={cast} />;
    case "summary":
    case "abandoned":
      return <MatchArena client={client} roomId={roomId} voice={voice} cast={cast} />;
    default:
      return null;
  }
}
