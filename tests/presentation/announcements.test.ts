import { describe, expect, it } from "vitest";
import {
  announceEnd,
  announceEvent,
  announceTurn,
  describePieceChoice,
  ordinal,
} from "../../lib/presentation/announcements";
import { deriveStateFromPathIndex } from "../../lib/board/geometry";
import { getLegalMoves } from "../../lib/board/rules";
import type { GameRoomState, GameType, Pawn, Player, PlayerColor } from "../../lib/board/types";
import type { MatchEventRow } from "../../lib/realtime/room-channel";

function pawn(color: PlayerColor, pathIndex: number | null, index = 0): Pawn {
  return { id: `${color}-${index}`, color, index, pathIndex, state: deriveStateFromPathIndex(pathIndex) };
}

function player(id: string, color: PlayerColor, seatIndex: number): Player {
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
  };
}

function room(extra: Partial<GameRoomState> = {}, gameType: GameType = "ludo"): GameRoomState {
  return {
    roomId: "room",
    code: "ABCD",
    gameType,
    status: "in_game",
    isParty: false,
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

let sequence = 0;
function event(event_type: string, player_id: string | null, payload: Record<string, unknown>): MatchEventRow {
  sequence += 1;
  return { id: sequence, sequence, event_type, player_id, payload, created_at: "" };
}

describe("screen-reader announcements", () => {
  it("says who rolled what, and 'You' for this seat", () => {
    const state = room();
    expect(announceEvent(event("dice_rolled", "Alex", { dieValue: 4 }), state, "Sam")).toBe(
      "Alex rolled a 4.",
    );
    expect(announceEvent(event("dice_rolled", "Sam", { dieValue: 6 }), state, "Sam")).toBe(
      "You rolled a 6.",
    );
    expect(
      announceEvent(
        event("dice_rolled", "Sam", { dieValue: 6, cancelledByThirdSix: true }),
        state,
        "Sam",
      ),
    ).toBe("You rolled a 6. Three sixes in a row cancel out, so the turn passes.");
  });

  it("names whose piece was captured", () => {
    // Red's pathIndex 4 is yellow's pathIndex 30 (see controller.test.ts).
    const pawns = [pawn("red", 1), pawn("yellow", 30)];
    const [move] = getLegalMoves(pawns, "red", 3);
    const state = room({ pawns });
    expect(announceEvent(event("legal_move_selected", "Sam", { ...move }), state, "Alex")).toBe(
      "Sam captured your piece.",
    );
    expect(announceEvent(event("legal_move_selected", "Sam", { ...move }), state, null)).toBe(
      "Sam captured Alex's piece.",
    );
  });

  it("calls out leaving base and getting home, but not a plain move", () => {
    const pawns = [pawn("red", null, 0), pawn("red", 18, 1), pawn("red", 53, 2)];
    const state = room({ pawns });
    const sixes = getLegalMoves(pawns, "red", 6);
    const out = sixes.find((m) => m.pawnId === "red-0")!;
    const along = sixes.find((m) => m.pawnId === "red-1")!;
    const [home] = getLegalMoves([pawn("red", 53, 2)], "red", 3);
    expect(announceEvent(event("legal_move_selected", "Sam", { ...out }), state, null)).toBe(
      "Sam brought a piece out of base.",
    );
    expect(announceEvent(event("legal_move_selected", "Sam", { ...along }), state, null)).toBeNull();
    expect(announceEvent(event("legal_move_selected", "Sam", { ...home }), state, null)).toBe(
      "Sam got a piece home.",
    );
  });

  it("reads out finishing places and timeouts", () => {
    const state = room();
    expect(announceEvent(event("player_finished", "Alex", { place: 2 }), state, null)).toBe(
      "Alex finished 2nd.",
    );
    expect(announceEvent(event("decision_timed_out", "Alex", {}), state, null)).toBe(
      "Alex ran out of time.",
    );
    expect(announceEvent(event("chat_message", "Alex", {}), state, null)).toBeNull();
  });

  it("follows Snakes & Ladders' snakes and ladders", () => {
    const state = room({ pawns: [pawn("red", 1)] }, "snakes_and_ladders");
    // Board 0 has a ladder from 4 to 16 and a snake from 22 to 2.
    const ladder = {
      pawnId: "red-0",
      fromTileId: "snakes:1",
      toTileId: "snakes:16",
      capturesPawnIds: [],
      finishesPawn: false,
      landingSquare: 4,
    };
    const snake = { ...ladder, toTileId: "snakes:2", landingSquare: 22 };
    expect(announceEvent(event("legal_move_selected", "Sam", ladder), state, null)).toBe(
      "Sam climbed a ladder from 4 to 16.",
    );
    expect(announceEvent(event("legal_move_selected", "Sam", snake), state, null)).toBe(
      "Sam slid down a snake from 22 to 2.",
    );
  });

  it("says whose turn it is and how the match ended", () => {
    const state = room();
    expect(announceTurn(state, "Sam", "Sam")).toBe("Your turn.");
    expect(announceTurn(state, "Alex", "Sam")).toBe("Alex's turn.");
    expect(announceEnd(room({ status: "summary", winnerIds: ["Sam", "Alex"] }), "Sam")).toBe(
      "You win the match!",
    );
    expect(announceEnd(room({ status: "summary", winnerIds: ["Alex", "Sam"] }), "Sam")).toBe(
      "Alex wins the match.",
    );
    expect(announceEnd(room({ status: "abandoned" }), "Sam")).toBe("The match has ended.");
  });

  it("orders places in English", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd",
    ]);
  });
});

describe("keyboard piece list", () => {
  it("labels each movable piece with where it is and what the move does", () => {
    const pawns = [pawn("red", 1), pawn("yellow", 30)];
    const state = room({ pawns, legalMoves: getLegalMoves(pawns, "red", 3) });
    expect(describePieceChoice(state, state.legalMoves[0])).toBe(
      "Piece 1, 55 to go: captures Alex's piece",
    );
    const base = [pawn("red", null, 1)];
    const out = room({ pawns: base, legalMoves: getLegalMoves(base, "red", 6) });
    expect(describePieceChoice(out, out.legalMoves[0])).toBe("Piece 2, in base: comes out of base");
  });
});
