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

export type GameType = "ludo";
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
}

export interface Pawn {
  id: string;
  playerId: string;
  state: PawnState;
  /** 0-56 forward-progress index, relative to the pawn's own color. See geometry.ts. */
  pathIndex: number | null;
  boardTileId: string | null;
}

export interface LegalMove {
  pawnId: string;
  fromTileId: string | null;
  toTileId: string;
  capturesPawnIds: string[];
  finishesPawn: boolean;
}

export interface GameRoomState {
  roomId: string;
  gameType: GameType;
  status: "lobby" | "in_game" | "summary";
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
