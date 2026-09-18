/**
 * Shared game-state types, mirrored from docs/PRD.md Section 6.7.
 *
 * This module has zero Supabase imports and zero side effects — it's used
 * client-side for rendering and legal-move highlighting ONLY. It is never
 * authoritative; the plpgsql functions in supabase/migrations are the source
 * of truth. See docs/IMPLEMENTATION_HANDOFF.md Section 2 on why this exists
 * as a second implementation alongside the SQL rules engine, and why the two
 * must be kept in sync via tests/parity.
 */

export type GameType = "ludo" | "snakes_and_ladders";
export type PlayerColor = "red" | "green" | "yellow" | "blue";
export type PlayerStatus = "connected" | "disconnected" | "inactive" | "bot";
export type TurnPhase =
  | "awaiting_roll"
  | "awaiting_move"
  | "resolving"
  | "complete";
export type PawnState = "nest" | "track" | "home_lane" | "finished";
export type MatchEndReason = "completed" | "abandoned";

export interface Player {
  id: string;
  seatIndex: number;
  displayName: string;
  color: PlayerColor;
  status: PlayerStatus;
  isBot: boolean;
  missedDecisionCount: number;
  level: number;
  testWalletBalance: number;
  /** PRD 5.2 Auto-Roll — added in M3; not in the original PRD 6.7 Player shape. */
  autoRollEnabled: boolean;
  /** PRD 5.3 rematch vote — added in M4. */
  rematchReady: boolean;
  /** Room voice chat: has this seat joined the call. */
  inVoice: boolean;
}

/**
 * Matches the actual jsonb shape `private.ludo_room_pawns_json` produces on
 * the wire (id/color/index/state/pathIndex) — the same shape as
 * EnginePawn (engine-types.ts), reused as-is for `GameRoomState.pawns`
 * rather than re-shaped into a separate DB-row-like format. A pawn's owner
 * is found by matching `color` against a `Player.color` — safe because a
 * room has at most one player per color.
 */
export interface Pawn {
  id: string;
  color: PlayerColor;
  /** Stable 0-3 ordering, mirrors the DB's pawn_index column. */
  index: number;
  state: PawnState;
  /** Luddo: color-relative 0–56. Snakes & Ladders: square 1–100. Null is off-board. */
  pathIndex: number | null;
}

export interface LegalMove {
  pawnId: string;
  fromTileId: string | null;
  toTileId: string;
  capturesPawnIds: string[];
  finishesPawn: boolean;
  /** Snakes & Ladders: square reached by the die, before a snake or ladder. */
  landingSquare?: number;
}

export interface GameRoomState {
  roomId: string;
  /** Present for server rooms; practice identifies its host by seat zero. */
  hostPlayerId?: string | null;
  /** Join code shown/shared in the lobby. Added to the wire shape in M4 — the initial PRD 6.7 shape omitted it. */
  code: string;
  gameType: GameType;
  status: "lobby" | "in_game" | "summary" | "abandoned";
  players: Player[];
  pawns: Pawn[];
  turnPlayerId: string | null;
  turnPhase: TurnPhase;
  turnDeadlineAt: string | null;
  rollsThisTurn: number;
  activeDiceValue: number | null;
  consecutiveSixes: number;
  legalMoves: LegalMove[];
  winnerIds: string[];
  matchEndReason: MatchEndReason | null;
  eventSequence: number;
}
