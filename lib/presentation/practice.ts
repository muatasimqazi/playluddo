import {
  applyMove,
  DEFAULT_ROOM_RULES,
  earnsBonusRoll,
  evaluateSixRoll,
  isMatchWon,
  nextPlayableDie,
} from "../board/rules";
import type { GameRoomState, GameType, PlayerColor, RoomRules } from "../board/types";
import { applySnakeMove, snakeMove } from "../board/snakes";
import type { BotLevel } from "../board/bot";
import { DIAGONAL_COLOR } from "./board";
import type { MatchEventRow } from "../realtime/room-channel";

/**
 * The bases in clockwise order around the board (BASE_AREA: red top-left,
 * green top-right, yellow bottom-right, blue bottom-left) — the same order
 * as the SQL engine's seat indexes (private.ludo_color_for_seat).
 */
export const CLOCKWISE_COLORS: readonly PlayerColor[] = [
  "red",
  "green",
  "yellow",
  "blue",
];

/**
 * One take-back step (docs/COMPETITIVE_ROADMAP.md F4.5): the whole session as
 * it stood *before* an action was applied. Snapshots are cheap for local play
 * and let undo rewind not just your move but everything the computers did in
 * response to it.
 */
export interface PracticeHistoryEntry {
  state: GameRoomState;
  events: MatchEventRow[];
  actionType: PracticeAction["type"];
  /** True when the seat that was about to act is a computer. */
  actorIsBot: boolean;
}
/** How many take-back steps we keep. Enough for a full match; bounds the save. */
const HISTORY_LIMIT = 50;

export interface PracticeSession {
  state: GameRoomState;
  events: MatchEventRow[];
  /** How the computers play (docs/COMPETITIVE_ROADMAP.md F1.4). Absent on older saves: Normal. */
  botLevel?: BotLevel;
  /** Take-back stack (F4.5). Absent on older saves: nothing to undo yet. */
  history?: PracticeHistoryEntry[];
  /**
   * A random id for this game, made when it is set up and kept through moves,
   * undo and reloads (it is saved with the session). Analytics uses it as the
   * offline `game_id` (docs/analytics.md); nothing else reads it. Absent on
   * older saves.
   */
  id?: string;
}

/** A random id for a local game; never derived from anything about the players. */
export function newLocalGameId(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return `local-${hex}`;
}
export interface PracticeProfile {
  displayName?: string;
  avatarId?: string;
  country?: string;
}
// A game saved on this device before room rules existed keeps the rules it
// started with, which had no extra roll for getting home. Mirrors the
// server's rollout in supabase/migrations/20260928040000_room_rules.sql.
const RULES_BEFORE_ROOM_RULES: RoomRules = { ...DEFAULT_ROOM_RULES, bonusRollOnFinish: false };

export function createPractice(
  gameType: GameType = "ludo",
  playerCount: 2 | 3 | 4 = 4,
  playerColor: PlayerColor = "blue",
  profile: PracticeProfile = {},
  botLevel: BotLevel = "normal",
  /** Which printed Snakes & Ladders board to play (F2.6); ignored by Ludo. */
  snakesBoard = 0,
): PracticeSession {
  // A 2-player game seats the two players diagonally across the board
  // (same pairing the SQL room engine uses); 3-4 players fill the bases
  // clockwise from the player's own. Turns follow seat order, so this is
  // what makes play go round the table clockwise — the same direction the
  // pawns travel, and the same order online rooms get from their fixed
  // red/green/yellow/blue seats.
  const start = CLOCKWISE_COLORS.indexOf(playerColor);
  const colors =
    playerCount === 2
      ? [playerColor, DIAGONAL_COLOR[playerColor]]
      : Array.from(
          { length: playerCount },
          (_, i) => CLOCKWISE_COLORS[(start + i) % CLOCKWISE_COLORS.length],
        );
  return {
    state: {
      roomId: "practice",
      code: "LOCAL",
      gameType,
      status: "in_game",
      rules: snakesBoard === 1 ? { ...DEFAULT_ROOM_RULES, snakesBoard: 1 } : DEFAULT_ROOM_RULES,
      players: colors.map((color, i) => ({
        id: `practice-${i}`,
        seatIndex: i,
        displayName: i === 0 ? profile.displayName || "You" : ["You", "Rowan", "Sage", "Jules"][i],
        color,
        status: i ? "bot" : "connected",
        isBot: i > 0,
        missedDecisionCount: 0,
        level: 1,
        testWalletBalance: 0,
        autoRollEnabled: false,
        rematchReady: false,
        inVoice: false,
        cameraOn: false,
        avatarId: i === 0 ? profile.avatarId || "fox" : ["fox", "panda", "owl", "frog"][i],
        country: i === 0 ? profile.country || "" : "",
      })),
      pawns: colors.flatMap((color) =>
        Array.from({ length: gameType === "ludo" ? 4 : 1 }, (_, index) => ({
          id: `${color}-${index}`,
          color,
          index,
          state: "nest" as const,
          pathIndex: null,
        })),
      ),
      turnPlayerId: "practice-0",
      turnPhase: "awaiting_roll",
      turnDeadlineAt: null,
      rollsThisTurn: 0,
      activeDiceValue: null,
      consecutiveSixes: 0,
      pendingDice: [],
      legalMoves: [],
      winnerIds: [],
      matchEndReason: null,
      eventSequence: 0,
    },
    events: [],
    botLevel,
    id: newLocalGameId(),
  };
}
export type PracticeAction =
  | { type: "roll"; value: number }
  | { type: "move"; pawnId: string }
  | { type: "undo" }
  | { type: "reset" };

/** Used only by the explicitly offline practice route. Online actions always use RPCs. */
export function practiceReducer(
  session: PracticeSession,
  action: PracticeAction,
): PracticeSession {
  if (action.type === "reset")
    return createPractice(
      session.state.gameType,
      session.state.players.length as 2 | 3 | 4,
      session.state.players[0].color,
      session.state.players[0],
      session.botLevel,
      session.state.rules?.snakesBoard,
    );
  if (action.type === "undo") return undoLastMove(session);
  const { state } = session;
  if (state.status !== "in_game") return session;
  const actor = state.players.find((p) => p.id === state.turnPlayerId);
  const result =
    state.gameType === "snakes_and_ladders"
      ? snakePracticeReducer(session, action)
      : ludoPracticeReducer(session, action);
  // The core reducers return the same session object for a rejected action;
  // don't record a take-back step for a move that never happened.
  if (result === session) return session;
  const entry: PracticeHistoryEntry = {
    state,
    events: session.events,
    actionType: action.type,
    actorIsBot: !!actor?.isBot,
  };
  return {
    ...result,
    history: [...(session.history ?? []), entry].slice(-HISTORY_LIMIT),
  };
}

/**
 * A take-back point is your own last committed Luddo move (F4.5). Undo rewinds
 * to just before it — restoring the board, the dice you'd already rolled, and
 * the piece choice — so you re-pick a piece without re-rolling. Snakes &
 * Ladders has no piece decision (the die fixes the move), so it records no
 * "move" steps and there is nothing to take back; likewise a computer's move
 * is never a take-back point.
 */
function isTakeBackStep(entry: PracticeHistoryEntry): boolean {
  return entry.actionType === "move" && !entry.actorIsBot;
}

/** Whether {@link PracticeAction} `undo` would change anything — for the UI. */
export function canUndoLastMove(session: PracticeSession): boolean {
  return (session.history ?? []).some(isTakeBackStep);
}

function undoLastMove(session: PracticeSession): PracticeSession {
  const history = session.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (!isTakeBackStep(history[i])) continue;
    const entry = history[i];
    return {
      ...session,
      state: entry.state,
      events: entry.events,
      history: history.slice(0, i),
    };
  }
  return session;
}

function ludoPracticeReducer(
  session: PracticeSession,
  action: PracticeAction,
): PracticeSession {
  const { state } = session;
  // undo/reset are resolved by the wrapper; only roll and move reach here.
  if (action.type !== "roll" && action.type !== "move") return session;
  const player = state.players.find((p) => p.id === state.turnPlayerId)!;
  let next = { ...state };
  let event: MatchEventRow;
  const advance = () => {
    const nextPlayer = Array.from(
      { length: state.players.length },
      (_, i) =>
        state.players[(player.seatIndex + i + 1) % state.players.length],
    ).find((candidate) => !isMatchWon(next.pawns, candidate.color));
    if (!nextPlayer) return;
    next = {
      ...next,
      turnPlayerId: nextPlayer.id,
      turnPhase: "awaiting_roll",
      activeDiceValue: null,
      legalMoves: [],
      consecutiveSixes: 0,
      rollsThisTurn: 0,
      pendingDice: [],
      bonusRollPending: false,
    };
  };
  // Move by the next of the turn's dice that can move anything; once none
  // is left, take any extra roll a capture or a piece home has earned.
  const playNextDie = (dice: number[], bonusRollPending: boolean) => {
    const die = nextPlayableDie(next.pawns, player.color, dice);
    if (die)
      next = {
        ...next,
        activeDiceValue: die.dieValue,
        pendingDice: die.rest,
        legalMoves: die.legalMoves,
        turnPhase: "awaiting_move",
        bonusRollPending,
      };
    else if (bonusRollPending)
      next = {
        ...next,
        activeDiceValue: null,
        pendingDice: [],
        legalMoves: [],
        turnPhase: "awaiting_roll",
        bonusRollPending: false,
      };
    else advance();
  };
  if (action.type === "roll") {
    if (
      state.turnPhase !== "awaiting_roll" ||
      !Number.isInteger(action.value) ||
      action.value < 1 ||
      action.value > 6
    )
      return session;
    const six = evaluateSixRoll(state.consecutiveSixes, action.value);
    // The sixes already rolled this turn. Without a streak there are none,
    // whatever an older save left behind.
    const sixes = state.consecutiveSixes > 0 ? (state.pendingDice ?? []) : [];
    next = {
      ...next,
      consecutiveSixes: six.consecutiveSixesAfter,
      rollsThisTurn: state.rollsThisTurn + 1,
    };
    event = {
      id: state.eventSequence + 1,
      sequence: state.eventSequence + 1,
      event_type: "dice_rolled",
      player_id: player.id,
      payload: { dieValue: action.value, cancelledByThirdSix: six.cancelMove },
      created_at: new Date().toISOString(),
    };
    // Three sixes in a row count for nothing: the turn passes.
    if (six.cancelMove) advance();
    // A six is rolled again before anything moves.
    else if (action.value === 6)
      next = { ...next, pendingDice: [...sixes, 6], activeDiceValue: null, legalMoves: [] };
    else playNextDie([...sixes, action.value], false);
  } else {
    if (state.turnPhase !== "awaiting_move") return session;
    const move = state.legalMoves.find((m) => m.pawnId === action.pawnId);
    if (!move) return session;
    next = {
      ...next,
      pawns: applyMove(state.pawns, move),
      legalMoves: [],
      activeDiceValue: null,
    };
    event = {
      id: state.eventSequence + 1,
      sequence: state.eventSequence + 1,
      event_type: "legal_move_selected",
      player_id: player.id,
      payload: { ...move },
      created_at: new Date().toISOString(),
    };
    if (isMatchWon(next.pawns, player.color)) {
      const winnerIds = state.winnerIds.includes(player.id)
        ? state.winnerIds
        : [...state.winnerIds, player.id];
      // 3-4 player matches wait for literally everyone to finish (deciding
      // 2nd/3rd/4th place too), but that degenerates for exactly 2 players
      // into "wait for the loser too" — the match never completes on a
      // win at all. Mirrors the server's
      // supabase/migrations/20260928030000_two_player_ludo_ends_on_first_win.sql.
      const complete =
        (state.players.length === 2 && winnerIds.length >= 1) ||
        winnerIds.length >= state.players.length;
      next = {
        ...next,
        winnerIds,
        ...(complete
          ? {
              status: "summary" as const,
              turnPhase: "complete" as const,
              matchEndReason: "completed" as const,
            }
          : {}),
      };
      if (!complete) advance();
    } else
      playNextDie(
        state.pendingDice ?? [],
        !!state.bonusRollPending ||
          earnsBonusRoll(move, state.rules ?? RULES_BEFORE_ROOM_RULES),
      );
  }
  next.eventSequence = state.eventSequence + 1;
  return { ...session, state: next, events: [...session.events, event].slice(-100) };
}

function snakePracticeReducer(
  session: PracticeSession,
  action: PracticeAction,
): PracticeSession {
  const { state } = session;
  if (
    action.type !== "roll" ||
    state.turnPhase !== "awaiting_roll" ||
    !Number.isInteger(action.value) ||
    action.value < 1 ||
    action.value > 6
  )
    return session;
  const player = state.players.find((p) => p.id === state.turnPlayerId)!;
  const pawn = state.pawns.find(
    (p) => p.color === player.color && p.state !== "finished",
  )!;
  const move = snakeMove(state.pawns, player.color, action.value, state.rules);
  const pawns = move ? applySnakeMove(state.pawns, move) : state.pawns;
  const winnerIds = move?.finishesPawn
    ? [...state.winnerIds, player.id]
    : state.winnerIds;
  // Same fix as the Ludo branch above: a 2-player match ends on the first
  // (only) win instead of waiting for the loser too.
  const complete =
    (state.players.length === 2 && winnerIds.length >= 1) ||
    winnerIds.length >= state.players.length;
  const earnsAnotherRoll = action.value === 6 && !move?.finishesPawn;
  const nextPlayer = Array.from(
    { length: state.players.length },
    (_, i) => state.players[(player.seatIndex + i + 1) % state.players.length],
  ).find((candidate) => !winnerIds.includes(candidate.id));
  const events: MatchEventRow[] = [];
  const append = (event_type: string, payload: Record<string, unknown>) => {
    const sequence = state.eventSequence + events.length + 1;
    events.push({
      id: sequence,
      sequence,
      event_type,
      player_id: player.id,
      payload,
      created_at: new Date().toISOString(),
    });
  };
  append("dice_rolled", {
    dieValue: action.value,
    cancelledByThirdSix: false,
    overshoot: !move && pawn.pathIndex !== null,
    needsSixToEnter: !move && pawn.pathIndex === null,
  });
  if (move) append("legal_move_selected", { ...move });
  if (move?.finishesPawn)
    append("player_finished", { place: winnerIds.length });
  if (complete)
    append("match_completed", {
      winnerId: winnerIds[0],
      placements: winnerIds,
    });
  return {
    ...session,
    state: {
      ...state,
      pawns,
      winnerIds,
      status: complete ? "summary" : "in_game",
      turnPlayerId: complete
        ? null
        : earnsAnotherRoll
          ? player.id
          : (nextPlayer?.id ?? null),
      turnPhase: complete ? "complete" : "awaiting_roll",
      activeDiceValue: null,
      legalMoves: [],
      rollsThisTurn: 0,
      consecutiveSixes: 0,
      matchEndReason: complete ? "completed" : null,
      eventSequence: state.eventSequence + events.length,
    },
    events: [...session.events, ...events].slice(-100),
  };
}

export function randomDie(): number {
  const bytes = new Uint8Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= 252);
  return (bytes[0] % 6) + 1;
}
