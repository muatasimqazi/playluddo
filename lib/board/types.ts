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
  /** Master mode (F2.2): this seat has captured, so its pieces can go home. */
  hasCaptured?: boolean;
  /** Party Mode: this seat is playing from somewhere else, not the living room (P8). */
  partyRemote?: boolean;
  /** Curated VRM avatar identifier stored in Supabase Auth metadata. */
  avatarId?: string;
  /** ISO 3166-1 alpha-2 country code from the player's profile. */
  country?: string;
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

/**
 * A room's house rules (docs/COMPETITIVE_ROADMAP.md F0.2). Mirrors the SQL
 * private.ludo_default_rules(); every key the server accepts appears here.
 */
export interface RoomRules {
  /** An extra roll when a pawn gets home (F1.5). On by default. */
  bonusRollOnFinish: boolean;
  /** Quick mode (F2.1): pieces that begin on the board instead of in base, 0-4. */
  startOnBoard: number;
  /** Quick mode (F2.1): pieces that have to get home to win, 1-4. */
  pawnsToWin: number;
  /** Master mode (F2.2): a piece only enters the home column once its player has captured. */
  captureToEnterHome: boolean;
  /** Snakes & Ladders (F2.6): any roll puts a piece on the board, not only a six. */
  snakesAnyRollToStart: boolean;
  /** Snakes & Ladders (F2.6): overshooting 100 bounces back instead of not moving. */
  snakesBounceBack: boolean;
  /** Rush mode (F2.3): minutes on the match clock — 0 for no clock, or 5 or 10. */
  matchMinutes: number;
  /** Blockades (F2.4): two pieces of one colour on an unsafe square stop everyone else. */
  blockades: boolean;
  /** How long a player has to take their turn (F2.4): 10, 15 or 30 seconds. */
  turnSeconds: number;
}

/**
 * One seat's stats for a match, derived on the server from the match's
 * events (private.match_stats in supabase/migrations/20260928050000_match_stats.sql).
 */
export interface MatchStats {
  rolls: number;
  sixes: number;
  /** How often each face came up: index 0 is face 1, index 5 is face 6. */
  faces: number[];
  turns: number;
  capturesMade: number;
  pawnsLost: number;
  pawnsFinished: number;
  missedDecisions: number;
  longestRunWithoutSix: number;
}

/** A seat's result, as get_match_results returns it. */
export interface MatchResult {
  playerId: string;
  seatIndex: number;
  color: PlayerColor;
  isBot: boolean;
  /** 1 = first. Null when the match was abandoned. */
  placement: number | null;
  stats: MatchStats;
}

export interface GameRoomState {
  roomId: string;
  /** Present for server rooms; practice identifies its host by seat zero. */
  hostPlayerId?: string | null;
  /** Join code shown/shared in the lobby. Added to the wire shape in M4 — the initial PRD 6.7 shape omitted it. */
  code: string;
  gameType: GameType;
  status: "lobby" | "in_game" | "summary" | "abandoned";
  paused?: boolean;
  /** Party Mode: the player whose phone the table is waiting for (P5), if any. */
  pausedForPlayerId?: string | null;
  /** When the current pause began. A wait for a phone ends 2 minutes on. */
  pausedAt?: string | null;
  /** Rush mode (F2.3): when the match clock runs out, if it has one. */
  matchEndsAt?: string | null;
  /** Seats the room was created for (2-4). Absent on older snapshots — treat as 4. */
  maxPlayers?: number;
  /** The room's resolved house rules. Absent on older snapshots — treat as the defaults. */
  rules?: RoomRules;
  /** A Party Mode room, shown on a shared screen. Absent on older snapshots. */
  isParty?: boolean;
  partyLocked?: boolean;
  partyTurnSeconds?: number;
  /** The current or latest match. Absent on older snapshots. */
  matchId?: string | null;
  /** That match's dice commitment (lib/presentation/diceProof.ts), published before its first roll. */
  diceCommitment?: string | null;
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
