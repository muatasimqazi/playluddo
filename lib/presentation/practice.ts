import {
  applyMove,
  earnsBonusRoll,
  evaluateSixRoll,
  getLegalMoves,
  isMatchWon,
} from "../board/rules";
import type { GameRoomState, GameType, PlayerColor } from "../board/types";
import { applySnakeMove, snakeMove } from "../board/snakes";
import type { MatchEventRow } from "../realtime/room-channel";

export interface PracticeSession {
  state: GameRoomState;
  events: MatchEventRow[];
}
export function createPractice(gameType: GameType = "ludo"): PracticeSession {
  const colors: PlayerColor[] = ["blue", "red", "green", "yellow"];
  return {
    state: {
      roomId: "practice",
      code: "LOCAL",
      gameType,
      status: "in_game",
      players: colors.map((color, i) => ({
        id: `practice-${i}`,
        seatIndex: i,
        displayName: ["You", "Rowan", "Sage", "Jules"][i],
        color,
        status: i ? "bot" : "connected",
        isBot: i > 0,
        missedDecisionCount: 0,
        level: 1,
        testWalletBalance: 0,
        autoRollEnabled: false,
        rematchReady: false,
        inVoice: false,
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
      legalMoves: [],
      winnerIds: [],
      matchEndReason: null,
      eventSequence: 0,
    },
    events: [],
  };
}
export type PracticeAction =
  | { type: "roll"; value: number }
  | { type: "move"; pawnId: string }
  | { type: "reset" };

/** Used only by the explicitly offline practice route. Online actions always use RPCs. */
export function practiceReducer(
  session: PracticeSession,
  action: PracticeAction,
): PracticeSession {
  if (action.type === "reset") return createPractice(session.state.gameType);
  const { state } = session;
  if (state.status !== "in_game") return session;
  if (state.gameType === "snakes_and_ladders")
    return snakePracticeReducer(session, action);
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
    };
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
    const legal = six.cancelMove
      ? []
      : getLegalMoves(state.pawns, player.color, action.value);
    next = {
      ...next,
      activeDiceValue: action.value,
      consecutiveSixes: six.consecutiveSixesAfter,
      rollsThisTurn: state.rollsThisTurn + 1,
      legalMoves: legal,
      turnPhase: "awaiting_move",
    };
    event = {
      id: state.eventSequence + 1,
      sequence: state.eventSequence + 1,
      event_type: "dice_rolled",
      player_id: player.id,
      payload: { dieValue: action.value, cancelledByThirdSix: six.cancelMove },
      created_at: new Date().toISOString(),
    };
    if (!legal.length) advance();
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
      const complete = winnerIds.length === state.players.length;
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
    } else if (earnsBonusRoll(state.activeDiceValue!, move))
      next.turnPhase = "awaiting_roll";
    else advance();
  }
  next.eventSequence = state.eventSequence + 1;
  return { state: next, events: [...session.events, event].slice(-100) };
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
  const move = snakeMove(state.pawns, player.color, action.value);
  const pawns = move ? applySnakeMove(state.pawns, move) : state.pawns;
  const winnerIds = move?.finishesPawn
    ? [...state.winnerIds, player.id]
    : state.winnerIds;
  const complete = winnerIds.length === state.players.length;
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
    overshoot: !move,
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
    state: {
      ...state,
      pawns,
      winnerIds,
      status: complete ? "summary" : "in_game",
      turnPlayerId: nextPlayer?.id ?? null,
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
