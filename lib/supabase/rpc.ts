import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameRoomState, GameType } from "../board/types";

/**
 * Typed wrappers around the RPC surface in docs/IMPLEMENTATION_HANDOFF.md
 * Section 6 — every mutation the client can make. Each RPC re-derives
 * authorization/legality server-side; these wrappers just give the errors a
 * shape the UI can branch on instead of matching raw strings everywhere.
 */

export type RpcErrorCode =
  | "UNAUTHENTICATED"
  | "ROOM_NOT_FOUND"
  | "ALREADY_STARTED"
  | "ROOM_FULL"
  | "NOT_HOST"
  | "SEAT_TAKEN"
  | "NOT_ENOUGH_PLAYERS"
  | "NOT_YOUR_TURN"
  | "INVALID_PHASE"
  | "ILLEGAL_MOVE"
  | "SEAT_NOT_CONTROLLED"
  | "SESSION_REPLACED"
  | "NOTHING_TO_RECLAIM"
  | "ROOM_NOT_IN_SUMMARY"
  | "INVALID_SIGNAL_TARGET"
  | "UNKNOWN";

const KNOWN_CODES: ReadonlySet<string> = new Set<RpcErrorCode>([
  "UNAUTHENTICATED",
  "ROOM_NOT_FOUND",
  "ALREADY_STARTED",
  "ROOM_FULL",
  "NOT_HOST",
  "SEAT_TAKEN",
  "NOT_ENOUGH_PLAYERS",
  "NOT_YOUR_TURN",
  "INVALID_PHASE",
  "ILLEGAL_MOVE",
  "SEAT_NOT_CONTROLLED",
  "SESSION_REPLACED",
  "NOTHING_TO_RECLAIM",
  "ROOM_NOT_IN_SUMMARY",
  "INVALID_SIGNAL_TARGET",
]);

export class RpcError extends Error {
  code: RpcErrorCode;
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
    this.code = KNOWN_CODES.has(message) ? (message as RpcErrorCode) : "UNKNOWN";
  }
}

async function call<T>(
  client: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new RpcError(error.message);
  return data as T;
}

export function createRoom(client: SupabaseClient, displayName: string) {
  return call<{ roomId: string; code: string; playerId: string }>(client, "create_room", {
    p_display_name: displayName,
  });
}

export function joinRoom(client: SupabaseClient, code: string, displayName: string) {
  return call<{ roomId: string; code: string; playerId: string }>(client, "join_room", {
    p_code: code,
    p_display_name: displayName,
  });
}

export function fillBot(client: SupabaseClient, roomId: string, seatIndex: number) {
  return call<{ playerId: string }>(client, "fill_bot", {
    p_room_id: roomId,
    p_seat_index: seatIndex,
  });
}

export function startMatch(client: SupabaseClient, roomId: string) {
  return call<{ roomId: string }>(client, "start_match", { p_room_id: roomId });
}

export function setRoomGame(
  client: SupabaseClient,
  roomId: string,
  gameType: GameType,
) {
  return call<GameRoomState>(client, "set_room_game", {
    p_room_id: roomId,
    p_game_type: gameType,
  });
}

export function claimSeat(client: SupabaseClient, roomId: string) {
  return call<{ playerId: string; connectionToken: string }>(client, "claim_seat", {
    p_room_id: roomId,
  });
}

export function requestRoll(client: SupabaseClient, roomId: string, connectionToken: string | null) {
  return call<{ dieValue: number; legalMoves: unknown[]; cancelledByThirdSix: boolean }>(
    client,
    "request_roll",
    { p_room_id: roomId, p_connection_token: connectionToken },
  );
}

export function requestMove(
  client: SupabaseClient,
  roomId: string,
  pawnId: string,
  connectionToken: string | null,
) {
  return call<{ move: unknown; won: boolean }>(client, "request_move", {
    p_room_id: roomId,
    p_pawn_id: pawnId,
    p_connection_token: connectionToken,
  });
}

export function toggleAutoRoll(client: SupabaseClient, roomId: string, enabled: boolean) {
  return call<{ autoRollEnabled: boolean }>(client, "toggle_auto_roll", {
    p_room_id: roomId,
    p_enabled: enabled,
  });
}

export function reclaimSeat(client: SupabaseClient, roomId: string) {
  return call<{ playerId: string }>(client, "reclaim_seat", { p_room_id: roomId });
}

export function requestRematch(client: SupabaseClient, roomId: string) {
  return call<{ playerId: string }>(client, "request_rematch", { p_room_id: roomId });
}

export function acceptRematch(client: SupabaseClient, roomId: string) {
  return call<{ playerId: string }>(client, "accept_rematch", { p_room_id: roomId });
}

export function getRoomState(client: SupabaseClient, roomId: string) {
  return call<GameRoomState>(client, "get_room_state", { p_room_id: roomId });
}

export function joinVoice(client: SupabaseClient, roomId: string) {
  return call<{ inVoice: boolean }>(client, "join_voice", { p_room_id: roomId });
}

export function leaveVoice(client: SupabaseClient, roomId: string) {
  return call<{ inVoice: boolean }>(client, "leave_voice", { p_room_id: roomId });
}

export function sendWebrtcSignal(
  client: SupabaseClient,
  roomId: string,
  toPlayerId: string,
  signal: unknown,
) {
  return call<void>(client, "send_webrtc_signal", {
    p_room_id: roomId,
    p_to_player_id: toPlayerId,
    p_signal: signal,
  });
}
