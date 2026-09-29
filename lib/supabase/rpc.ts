import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameRoomState, GameType, MatchResult, PlayerColor, RoomRules } from "../board/types";
import type { DiceProof } from "../presentation/diceProof";

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
  | "INVALID_SEAT"
  | "INVALID_PLAYER_COUNT"
  | "TOO_MANY_SEATED"
  | "COLOR_TAKEN"
  | "NOT_ENOUGH_PLAYERS"
  | "NOT_YOUR_TURN"
  | "INVALID_PHASE"
  | "MATCH_PAUSED"
  | "ILLEGAL_MOVE"
  | "SEAT_NOT_CONTROLLED"
  | "SESSION_REPLACED"
  | "NOTHING_TO_RECLAIM"
  | "ROOM_NOT_IN_SUMMARY"
  | "INVALID_SIGNAL_TARGET"
  | "NOT_TEAM_MEMBER"
  | "INVALID_GAME_TYPE"
  | "INVALID_RULES"
  | "AGE_REQUIRED"
  | "AGE_RESTRICTED"
  | "AGE_ALREADY_DECLARED"
  | "INVALID_BIRTH_DATE"
  | "PARTY_LOCKED"
  | "PARTY_REMOVED"
  | "PARTY_ROOM"
  | "DISPLAY_CANNOT_SIT"
  | "NOT_PARTY_ROOM"
  | "ALREADY_SEATED"
  | "SEATS_OPEN"
  | "INVALID_NAME"
  | "AUDIENCE_FULL"
  | "NOT_AUDIENCE"
  | "PLAYER_NOT_FOUND"
  | "MOMENT_NOT_FOUND"
  | "UNKNOWN";

const KNOWN_CODES: ReadonlySet<string> = new Set<RpcErrorCode>([
  "UNAUTHENTICATED",
  "ROOM_NOT_FOUND",
  "ALREADY_STARTED",
  "ROOM_FULL",
  "NOT_HOST",
  "SEAT_TAKEN",
  "INVALID_SEAT",
  "INVALID_PLAYER_COUNT",
  "TOO_MANY_SEATED",
  "COLOR_TAKEN",
  "NOT_ENOUGH_PLAYERS",
  "NOT_YOUR_TURN",
  "INVALID_PHASE",
  "MATCH_PAUSED",
  "ILLEGAL_MOVE",
  "SEAT_NOT_CONTROLLED",
  "SESSION_REPLACED",
  "NOTHING_TO_RECLAIM",
  "ROOM_NOT_IN_SUMMARY",
  "INVALID_SIGNAL_TARGET",
  "NOT_TEAM_MEMBER",
  "INVALID_GAME_TYPE",
  "INVALID_RULES",
  "AGE_REQUIRED",
  "AGE_RESTRICTED",
  "AGE_ALREADY_DECLARED",
  "INVALID_BIRTH_DATE",
  "PARTY_LOCKED",
  "PARTY_REMOVED",
  "PARTY_ROOM",
  "DISPLAY_CANNOT_SIT",
  "NOT_PARTY_ROOM",
  "ALREADY_SEATED",
  "SEATS_OPEN",
  "INVALID_NAME",
  "AUDIENCE_FULL",
  "NOT_AUDIENCE",
  "PLAYER_NOT_FOUND",
  "MOMENT_NOT_FOUND",
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

export function createRoom(
  client: SupabaseClient,
  displayName: string,
  teamId?: string,
  maxPlayers?: number,
) {
  return call<{ roomId: string; code: string; playerId: string }>(client, "create_room", {
    p_display_name: displayName,
    p_team_id: teamId ?? null,
    p_max_players: maxPlayers ?? 4,
  });
}

export function joinRoom(client: SupabaseClient, code: string, displayName: string) {
  return call<{ roomId: string; code: string; playerId: string }>(client, "join_room", {
    p_code: code,
    p_display_name: displayName,
  });
}

export type MatchmakingResult =
  | {
      status: "waiting";
      waitedSeconds: number;
      timeoutSeconds: number;
      /** Other searchers for this game and table size found so far. */
      found: number;
      /** Opponents needed to fill the table (seats - 1). */
      needed: number;
    }
  | { status: "matched"; roomId: string; players: number; computers: number }
  | { status: "cancelled" };

/**
 * One quick-match poll: joins (or stays in) the queue for this game and
 * table size. Returns the room once the table fills with other searchers,
 * or after the server's 45s timeout with computers in any empty seats.
 */
export function matchmake(
  client: SupabaseClient,
  gameType: GameType,
  displayName: string,
  playerCount: 2 | 3 | 4,
) {
  return call<MatchmakingResult>(client, "matchmake", {
    p_game_type: gameType,
    p_display_name: displayName,
    p_player_count: playerCount,
  });
}

/** Leave the queue — or get the room if a pairing landed first. */
export function cancelMatchmaking(client: SupabaseClient) {
  return call<MatchmakingResult>(client, "cancel_matchmaking");
}

export interface RoomInvite {
  status: "lobby" | "in_game" | "summary" | "abandoned";
  gameType: GameType;
  maxPlayers: number;
  seatsTaken: number;
  hostName: string | null;
  isSeated: boolean;
  /** A Party Mode room. Absent from older servers. */
  isParty?: boolean;
  partyLocked?: boolean;
  /** This phone is in the party room's audience (P6). */
  isAudience?: boolean;
}

/** What a shared room link shows before joining (host, game, open seats). */
export function getRoomInvite(client: SupabaseClient, roomId: string) {
  return call<RoomInvite>(client, "room_invite", { p_room_id: roomId });
}

/** Take a seat from a shared room link — same rules as joinRoom, by id. */
export function joinRoomById(client: SupabaseClient, roomId: string, displayName: string) {
  return call<{ roomId: string; code: string; playerId: string }>(client, "join_room_by_id", {
    p_room_id: roomId,
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

/** Party Mode (docs/COMPETITIVE_ROADMAP.md Section 6): start a room from the shared screen. */
export function createPartyRoom(client: SupabaseClient, gameType: GameType) {
  return call<{ roomId: string; code: string }>(client, "create_party_room", {
    p_game_type: gameType,
  });
}

/** "Still here" from a phone in a party lobby, every 10 seconds; hands on the VIP role if the VIP is gone. */
export function partyHeartbeat(client: SupabaseClient, roomId: string) {
  return call<void>(client, "party_heartbeat", { p_room_id: roomId });
}

/** Where a party seat is playing from: the living room, or somewhere else (P8). */
export function setPartyRemote(client: SupabaseClient, roomId: string, remote: boolean) {
  return call<void>(client, "set_party_remote", { p_room_id: roomId, p_remote: remote });
}

/** Shows the piece a phone has picked on the party screen, before it confirms; null clears it. */
export function partyPreviewMove(client: SupabaseClient, roomId: string, pawnId: string | null) {
  return call<void>(client, "party_preview_move", { p_room_id: roomId, p_pawn_id: pawnId });
}

/** The screen's view of its party room. ROOM_NOT_FOUND unless this session is its screen. */
export function getPartyScreen(client: SupabaseClient, roomId: string) {
  return call<GameRoomState>(client, "get_party_screen", { p_room_id: roomId });
}

/** What the signed-in player may do (docs/COMPETITIVE_ROADMAP.md F0.4). Never carries birth data. */
export interface AgeEligibility {
  /** False while the server's age check is switched off: never ask. */
  required: boolean;
  declared: boolean;
  online: boolean;
  video: boolean;
  /** Set only for an under-13 answer: the day the block lifts (YYYY-MM-DD). */
  eligibleFrom: string | null;
}

export function getAgeEligibility(client: SupabaseClient) {
  return call<AgeEligibility>(client, "get_age_eligibility");
}

/** Once per account; the server rejects a second answer. */
export function declareAge(client: SupabaseClient, birthYear: number, birthMonth: number) {
  return call<AgeEligibility>(client, "declare_age", {
    p_birth_year: birthYear,
    p_birth_month: birthMonth,
  });
}

/** The latest match's dice; the seed is null until the match ends. Null for a match without one. */
export function getDiceProof(client: SupabaseClient, roomId: string) {
  return call<DiceProof | null>(client, "get_dice_proof", { p_room_id: roomId });
}

/** Every seat's result for the room's latest match; empty until it ends. */
export function getMatchResults(client: SupabaseClient, roomId: string) {
  return call<MatchResult[]>(client, "get_match_results", { p_room_id: roomId });
}

/** Host-only, lobby-only. Sends every rule; the server rejects unknown ones. */
export function setRoomRules(
  client: SupabaseClient,
  roomId: string,
  rules: RoomRules,
) {
  return call<GameRoomState>(client, "set_room_rules", {
    p_room_id: roomId,
    p_rules: rules,
  });
}

export function setRoomMaxPlayers(
  client: SupabaseClient,
  roomId: string,
  maxPlayers: number,
) {
  return call<GameRoomState>(client, "set_room_max_players", {
    p_room_id: roomId,
    p_max_players: maxPlayers,
  });
}

export function setPlayerColor(
  client: SupabaseClient,
  roomId: string,
  color: PlayerColor,
) {
  return call<GameRoomState>(client, "set_player_color", {
    p_room_id: roomId,
    p_color: color,
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

export function toggleMatchPause(client: SupabaseClient, roomId: string, paused: boolean) {
  return call<GameRoomState>(client, "toggle_match_pause", {
    p_room_id: roomId,
    p_paused: paused,
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

/** A candidate for Party Mode's moment of the match (private.party_moments). */
export interface PartyMoment {
  sequence: number;
  playerId: string;
  kind: "capture" | "finished" | "ladder" | "snake";
  place: number | null;
  capturedPlayerIds: string[];
  /** Snakes & Ladders: the square landed on, and where the ladder or snake led. */
  from: number | null;
  to: number | null;
}

/** What the audience adds to a party room (get_party_extras, P6). */
export interface PartyExtras {
  isAudience: boolean;
  audienceTopic?: string | null;
  audienceMembers?: { id: string; name: string; isMe: boolean }[];
  /** Audience names, in the order they joined. */
  audience: string[];
  /** The lobby's picks for the next game. */
  predictions: { playerId: string; count: number }[];
  myPrediction: string | null;
  /** This phone's pick for the current game, locked in at the start. */
  lockedPrediction: string | null;
  /** Once the game has ended: who picked the winner. */
  calledIt: string[] | null;
  predictionCount: number;
  moments: PartyMoment[];
  votes: { sequence: number; count: number }[];
  myVote: number | null;
}

/** Join a party room's audience, once its seats are full or the game has started. */
export function joinPartyAudience(client: SupabaseClient, roomId: string, displayName: string) {
  return call<{ roomId: string }>(client, "join_party_audience", {
    p_room_id: roomId,
    p_display_name: displayName,
  });
}

/** The table as an audience phone sees it. NOT_AUDIENCE unless it joined. */
export function getAudienceState(client: SupabaseClient, roomId: string) {
  return call<GameRoomState>(client, "get_audience_state", { p_room_id: roomId });
}

export function getPartyExtras(client: SupabaseClient, roomId: string) {
  return call<PartyExtras>(client, "get_party_extras", { p_room_id: roomId });
}

/** A reaction from the audience, shown on the screen with the sender's name. */
export function audienceReact(client: SupabaseClient, roomId: string, text: string) {
  return call<void>(client, "audience_react", { p_room_id: roomId, p_text: text });
}

/** The audience's pick to win, before the game starts. Bragging rights only. */
export function predictWinner(client: SupabaseClient, roomId: string, playerId: string) {
  return call<void>(client, "predict_winner", { p_room_id: roomId, p_player_id: playerId });
}

/** The audience's vote for the moment of the match, once it has ended. */
export function voteMoment(client: SupabaseClient, roomId: string, sequence: number) {
  return call<void>(client, "vote_moment", { p_room_id: roomId, p_sequence: sequence });
}

/** P7: only the room's own screen may change the lock after play starts. */
export function setPartyLocked(client: SupabaseClient, roomId: string, locked: boolean) {
  return call<void>(client, "set_party_locked", { p_room_id: roomId, p_locked: locked });
}
export function roomIdForCode(client: SupabaseClient, code: string) {
  return call<string>(client, "room_id_for_code", { p_code: code });
}
