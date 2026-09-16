import {
  applyMove,
  earnsBonusRoll,
  evaluateSixRoll,
  getLegalMoves,
  isMatchWon,
} from "../board/rules";
import type { GameRoomState, PlayerColor } from "../board/types";
import type { MatchEventRow } from "../realtime/room-channel";

export interface PracticeSession {
  state: GameRoomState;
  events: MatchEventRow[];
}
export function createPractice(): PracticeSession {
  const colors: PlayerColor[] = ["blue", "red", "green", "yellow"];
  return {
    state: {
      roomId: "practice",
      code: "LOCAL",
      gameType: "ludo",
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
      })),
      pawns: colors.flatMap((color) =>
        Array.from({ length: 4 }, (_, index) => ({
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
  if (action.type === "reset") return createPractice();
  const { state } = session;
  if (state.status !== "in_game") return session;
  const player = state.players.find((p) => p.id === state.turnPlayerId)!;
  const nextPlayer = state.players[(player.seatIndex + 1) % 4];
  let next = { ...state };
  let event: MatchEventRow;
  const advance = () => {
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
    if (isMatchWon(next.pawns, player.color))
      next = {
        ...next,
        status: "summary",
        turnPhase: "complete",
        winnerIds: [player.id],
        matchEndReason: "completed",
      };
    else if (earnsBonusRoll(state.activeDiceValue!, move))
      next.turnPhase = "awaiting_roll";
    else advance();
  }
  next.eventSequence = state.eventSequence + 1;
  return { state: next, events: [...session.events, event].slice(-100) };
}

export function randomDie(): number {
  const bytes = new Uint8Array(1);
  do {
    crypto.getRandomValues(bytes);
  } while (bytes[0] >= 252);
  return (bytes[0] % 6) + 1;
}
