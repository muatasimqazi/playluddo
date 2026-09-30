import { describe, expect, it } from "vitest";
import {
  clock,
  controllerPhase,
  partyWaitEndsAt,
  describeMove,
  forcedMovePawnId,
  pieceSteps,
  pieceWhere,
  placementOf,
  routeLength,
} from "../../lib/presentation/controller";
import { deriveStateFromPathIndex } from "../../lib/board/geometry";
import { getLegalMoves } from "../../lib/board/rules";
import { snakeMove } from "../../lib/board/snakes";
import type { GameRoomState, GameType, Pawn, Player, PlayerColor } from "../../lib/board/types";

function pawn(color: PlayerColor, pathIndex: number | null, index = 0): Pawn {
  return { id: `${color}-${index}`, color, index, pathIndex, state: deriveStateFromPathIndex(pathIndex) };
}

function player(id: string, color: PlayerColor, seatIndex: number, extra: Partial<Player> = {}): Player {
  return {
    id,
    seatIndex,
    displayName: id,
    color,
    status: "connected",
    isBot: false,
    missedDecisionCount: 0,
    level: 1,
    testWalletBalance: 0,
    autoRollEnabled: false,
    rematchReady: false,
    inVoice: false,
    cameraOn: false,
    ...extra,
  };
}

function room(extra: Partial<GameRoomState> = {}, gameType: GameType = "ludo"): GameRoomState {
  return {
    roomId: "room",
    code: "ABCD",
    gameType,
    status: "in_game",
    isParty: true,
    players: [player("Sam", "red", 0), player("Alex", "yellow", 2)],
    pawns: [],
    turnPlayerId: "Sam",
    turnPhase: "awaiting_roll",
    turnDeadlineAt: null,
    rollsThisTurn: 0,
    activeDiceValue: null,
    consecutiveSixes: 0,
    legalMoves: [],
    winnerIds: [],
    matchEndReason: null,
    eventSequence: 1,
    ...extra,
  };
}

describe("party controller phase", () => {
  const sam = player("Sam", "red", 0);
  it("is your roll, your move, or someone else's turn", () => {
    expect(controllerPhase(room(), sam)).toBe("roll");
    expect(controllerPhase(room({ turnPhase: "awaiting_move" }), sam)).toBe("move");
    expect(controllerPhase(room({ turnPhase: "resolving" }), sam)).toBe("resolving");
    expect(controllerPhase(room({ turnPlayerId: "Alex" }), sam)).toBe("waiting");
  });
  it("leaves rolling to auto-roll when it's on", () => {
    expect(controllerPhase(room(), { ...sam, autoRollEnabled: true })).toBe("auto_roll");
  });
  it("puts a held seat, a pause and the end ahead of the turn", () => {
    expect(controllerPhase(room(), { ...sam, status: "bot" })).toBe("reclaim");
    expect(controllerPhase(room({ paused: true }), sam)).toBe("paused");
    expect(controllerPhase(room({ status: "summary" }), sam)).toBe("ended");
    expect(controllerPhase(room({ status: "abandoned" }), sam)).toBe("ended");
  });
});

describe("forced moves", () => {
  it("plays a six with every piece in base for you", () => {
    const pawns = [0, 1, 2, 3].map((i) => pawn("red", null, i));
    expect(forcedMovePawnId(getLegalMoves(pawns, "red", 6))).toBe("red-0");
  });
  it("asks when two pieces would land in different places", () => {
    const pawns = [pawn("red", 3, 0), pawn("red", 10, 1)];
    expect(forcedMovePawnId(getLegalMoves(pawns, "red", 2))).toBeNull();
  });
  it("has nothing to play with no legal moves", () => {
    expect(forcedMovePawnId([])).toBeNull();
  });
});

describe("piece routes", () => {
  it("runs from base to home in 57 steps in Ludo", () => {
    const state = room();
    expect(routeLength(state)).toBe(57);
    expect(pieceSteps(state, pawn("red", null))).toBe(0);
    expect(pieceSteps(state, pawn("red", 0))).toBe(1);
    expect(pieceSteps(state, pawn("red", 56))).toBe(57);
  });
  it("uses the square number in Snakes & Ladders", () => {
    const state = room({}, "snakes_and_ladders");
    expect(routeLength(state)).toBe(100);
    expect(pieceSteps(state, pawn("red", 42))).toBe(42);
    expect(pieceWhere(state, pawn("red", 42))).toBe("Square 42");
    expect(pieceWhere(state, pawn("red", null))).toBe("Not on the board yet");
  });
  it("says where a Ludo piece is", () => {
    const state = room();
    expect(pieceWhere(state, pawn("red", null))).toBe("In base");
    expect(pieceWhere(state, pawn("red", 0))).toBe("56 to go · safe on a star");
    expect(pieceWhere(state, pawn("red", 5))).toBe("51 to go");
    expect(pieceWhere(state, pawn("red", 53))).toBe("Home column · 3 to go");
    expect(pieceWhere(state, pawn("red", 56))).toBe("Home");
  });
});

describe("move previews", () => {
  it("describes coming out of base", () => {
    const pawns = [pawn("red", null, 0), pawn("red", 18, 1)];
    const state = room({ pawns, legalMoves: getLegalMoves(pawns, "red", 6) });
    const out = state.legalMoves.find((m) => m.pawnId === "red-0")!;
    expect(describeMove(state, out)).toEqual({ pawnId: "red-0", toSteps: 1, text: "Comes out of base" });
    const along = state.legalMoves.find((m) => m.pawnId === "red-1")!;
    expect(describeMove(state, along)).toMatchObject({ toSteps: 25, text: "Moves 6 squares" });
  });
  it("names the player whose piece would be captured", () => {
    // Red's pathIndex 4 is global cell 4; yellow's entry is 26 cells on, so its pathIndex 30 is cell 4.
    const pawns = [pawn("red", 1), pawn("yellow", 30)];
    const state = room({ pawns, legalMoves: getLegalMoves(pawns, "red", 3) });
    expect(describeMove(state, state.legalMoves[0]).text).toBe("Captures Alex's piece");
  });
  it("calls out getting home, the home column and safe stars", () => {
    const home = [pawn("red", 53)];
    expect(describeMove(room({ pawns: home }), getLegalMoves(home, "red", 3)[0]).text).toBe("Gets home");
    const lane = [pawn("red", 48)];
    expect(describeMove(room({ pawns: lane }), getLegalMoves(lane, "red", 4)[0]).text).toBe(
      "Into the home column",
    );
    const star = [pawn("red", 5)];
    expect(describeMove(room({ pawns: star }), getLegalMoves(star, "red", 3)[0]).text).toBe(
      "Lands on a safe star",
    );
  });
  it("calls out snakes and ladders", () => {
    // Snakes & Ladders pieces are on the track until square 100.
    const piece = (pathIndex: number | null): Pawn => ({ ...pawn("red", null), pathIndex, state: pathIndex === null ? "nest" : "track" });
    const state = (pathIndex: number | null) => room({ pawns: [piece(pathIndex)] }, "snakes_and_ladders");
    const s = (pathIndex: number | null, die: number) =>
      describeMove(state(pathIndex), snakeMove(state(pathIndex).pawns, "red", die)!);
    expect(s(null, 6)).toMatchObject({ toSteps: 6, text: "Onto the board at square 6" });
    expect(s(1, 2)).toMatchObject({ toSteps: 23, text: "Climbs the ladder from 3 to 23" });
    expect(s(20, 2)).toMatchObject({ toSteps: 2, text: "Slides down the snake from 22 to 2" });
    expect(s(10, 1)).toMatchObject({ toSteps: 11, text: "Moves to square 11" });
    expect(s(97, 3)).toMatchObject({ toSteps: 100, text: "Reaches square 100 and wins" });
  });
});

describe("placement", () => {
  it("follows the finishing order", () => {
    const state = room({ status: "summary", winnerIds: ["Alex", "Sam"] });
    expect(placementOf(state, "Alex")).toBe(1);
    expect(placementOf(state, "Sam")).toBe(2);
    expect(placementOf(state, "Nobody")).toBeNull();
  });
});

describe("waiting for a phone", () => {
  it("ends two minutes after the table paused for it", () => {
    expect(partyWaitEndsAt({ pausedForPlayerId: "Sam", pausedAt: "2026-09-28T12:00:00.000Z" })).toBe(
      "2026-09-28T12:02:00.000Z",
    );
  });
  it("isn't a wait when the VIP paused, or nothing is paused", () => {
    expect(partyWaitEndsAt({ pausedForPlayerId: null, pausedAt: "2026-09-28T12:00:00.000Z" })).toBeNull();
    expect(partyWaitEndsAt({})).toBeNull();
  });
  it("shows minutes and seconds", () => {
    expect(clock(95)).toBe("1:35");
    expect(clock(120)).toBe("2:00");
    expect(clock(7)).toBe("0:07");
  });
});
