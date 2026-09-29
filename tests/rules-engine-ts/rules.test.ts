import { describe, expect, it } from "vitest";
import {
  applyMove,
  DEFAULT_ROOM_RULES,
  earnsBonusRoll,
  evaluateSixRoll,
  getLegalMoves,
  isMatchWon,
  rankPlayers,
  resolveRoomRules,
} from "../../lib/board/rules";
import type { EnginePawn } from "../../lib/board/engine-types";
import type { LegalMove, PlayerColor } from "../../lib/board/types";

function pawn(
  id: string,
  color: PlayerColor,
  index: number,
  state: EnginePawn["state"],
  pathIndex: number | null,
): EnginePawn {
  return { id, color, index, state, pathIndex };
}

/** A full 16-pawn board (all in nest by default), with specific pawns overridden. */
function makeBoard(overrides: Record<string, EnginePawn> = {}): EnginePawn[] {
  const colors: PlayerColor[] = ["red", "green", "yellow", "blue"];
  const pawns: EnginePawn[] = [];
  for (const color of colors) {
    for (let index = 0; index < 4; index++) {
      const id = `${color}-${index}`;
      pawns.push(overrides[id] ?? pawn(id, color, index, "nest", null));
    }
  }
  return pawns;
}

describe("getLegalMoves — nest exit", () => {
  it("requires a 6 to leave the nest", () => {
    const pawns = makeBoard();
    expect(getLegalMoves(pawns, "red", 5)).toHaveLength(0);
  });

  it("offers every nest pawn as a candidate move on a 6", () => {
    const pawns = makeBoard();
    const moves = getLegalMoves(pawns, "red", 6);
    expect(moves).toHaveLength(4);
    expect(moves[0]).toMatchObject({
      fromTileId: "nest:red",
      toTileId: "track:0",
      finishesPawn: false,
      capturesPawnIds: [],
    });
  });
});

describe("getLegalMoves — track movement", () => {
  it("advances a pawn by the die value", () => {
    const pawns = makeBoard({ "red-0": pawn("red-0", "red", 0, "track", 6) });
    const move = getLegalMoves(pawns, "red", 4).find((m) => m.pawnId === "red-0")!;
    expect(move.fromTileId).toBe("track:6");
    expect(move.toTileId).toBe("track:10");
  });

  it("excludes a pawn whose no-move-exists means the turn has nothing to do (no-move detection)", () => {
    const pawns = makeBoard(); // everyone in nest
    expect(getLegalMoves(pawns, "red", 3)).toHaveLength(0);
  });
});

describe("getLegalMoves — exact-roll home entry and overshoot", () => {
  it("excludes a pawn that would overshoot the final home cell", () => {
    const pawns = makeBoard({ "red-0": pawn("red-0", "red", 0, "home_lane", 53) });
    expect(getLegalMoves(pawns, "red", 4).some((m) => m.pawnId === "red-0")).toBe(false);
  });

  it("finishes a pawn on the exact roll", () => {
    const pawns = makeBoard({ "red-0": pawn("red-0", "red", 0, "home_lane", 53) });
    const move = getLegalMoves(pawns, "red", 3).find((m) => m.pawnId === "red-0")!;
    expect(move.finishesPawn).toBe(true);
    expect(move.toTileId).toBe("home:red:5");
  });

  it("finished pawns never appear in legal moves again", () => {
    const pawns = makeBoard({ "red-0": pawn("red-0", "red", 0, "finished", 56) });
    expect(getLegalMoves(pawns, "red", 6).some((m) => m.pawnId === "red-0")).toBe(false);
  });
});

describe("getLegalMoves — capture", () => {
  it("captures a single opponent pawn landed on exactly", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      "green-0": pawn("green-0", "green", 0, "track", 49), // global cell 10, same as red target
    });
    const move = getLegalMoves(pawns, "red", 4).find((m) => m.pawnId === "red-0")!;
    expect(move.toTileId).toBe("track:10");
    expect(move.capturesPawnIds).toEqual(["green-0"]);
  });

  it("captures every pawn in a stack on the same non-safe cell", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      "green-0": pawn("green-0", "green", 0, "track", 49),
      "green-1": pawn("green-1", "green", 1, "track", 49), // own-color stacking is legal
    });
    const move = getLegalMoves(pawns, "red", 4).find((m) => m.pawnId === "red-0")!;
    expect([...move.capturesPawnIds].sort()).toEqual(["green-0", "green-1"]);
  });

  it("never captures on a safe cell", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 4), // -> global 8, a safe cell
      "green-0": pawn("green-0", "green", 0, "track", 47), // also global 8
    });
    const move = getLegalMoves(pawns, "red", 4).find((m) => m.pawnId === "red-0")!;
    expect(move.toTileId).toBe("track:8");
    expect(move.capturesPawnIds).toEqual([]);
  });

  it("does not capture a pawn that is itself in a home lane, even landing on the same target cell", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6), // target cell 9 is on the shared track, non-safe
      "green-0": pawn("green-0", "green", 0, "home_lane", 51), // in its private lane, never capturable
    });
    const move = getLegalMoves(pawns, "red", 3).find((m) => m.pawnId === "red-0")!;
    expect(move.toTileId).toBe("track:9");
    expect(move.capturesPawnIds).toEqual([]);
  });
});

describe("getLegalMoves — blockades", () => {
  it("allows 2+ pawns of the same color to occupy one tile and still move independently", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 5),
      "red-1": pawn("red-1", "red", 1, "track", 5),
    });
    const moves = getLegalMoves(pawns, "red", 3);
    expect(moves.map((m) => m.pawnId).sort()).toEqual(["red-0", "red-1"]);
  });

  it("does not block movement by default", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      // Green path 48 maps to shared-track cell 9, red's target below.
      "green-0": pawn("green-0", "green", 0, "track", 48),
      "green-1": pawn("green-1", "green", 1, "track", 48),
    });
    expect(getLegalMoves(pawns, "red", 3).some((move) => move.pawnId === "red-0")).toBe(true);
  });

  it("prevents landing on or crossing an opposing blockade when enabled", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      "green-0": pawn("green-0", "green", 0, "track", 48),
      "green-1": pawn("green-1", "green", 1, "track", 48),
    });
    const rules = { blockades: true };
    expect(getLegalMoves(pawns, "red", 3, { rules }).some((move) => move.pawnId === "red-0")).toBe(false);
    expect(getLegalMoves(pawns, "red", 4, { rules }).some((move) => move.pawnId === "red-0")).toBe(false);
  });

  it("never treats own stacks or a stack on a safe cell as a blockade", () => {
    const ownStack = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      "red-1": pawn("red-1", "red", 1, "track", 9),
      "red-2": pawn("red-2", "red", 2, "track", 9),
    });
    expect(getLegalMoves(ownStack, "red", 3, { rules: { blockades: true } })
      .some((move) => move.pawnId === "red-0")).toBe(true);

    const safeStack = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      // Green path 47 maps to shared-track cell 8, a safe cell.
      "green-0": pawn("green-0", "green", 0, "track", 47),
      "green-1": pawn("green-1", "green", 1, "track", 47),
    });
    expect(getLegalMoves(safeStack, "red", 2, { rules: { blockades: true } })
      .some((move) => move.pawnId === "red-0")).toBe(true);
  });
});

describe("earnsBonusRoll", () => {
  const plainMove: LegalMove = {
    pawnId: "x",
    fromTileId: "track:1",
    toTileId: "track:2",
    capturesPawnIds: [],
    finishesPawn: false,
  };
  const captureMove: LegalMove = { ...plainMove, capturesPawnIds: ["y"] };
  const finishMove: LegalMove = { ...plainMove, finishesPawn: true };
  const rulesOff = { ...DEFAULT_ROOM_RULES, bonusRollOnFinish: false };

  it("grants a bonus roll on a six", () => {
    expect(earnsBonusRoll(6, plainMove, DEFAULT_ROOM_RULES)).toBe(true);
  });

  it("grants a bonus roll on a capture", () => {
    expect(earnsBonusRoll(3, captureMove, DEFAULT_ROOM_RULES)).toBe(true);
  });

  it("does not stack when a roll is both a six and a capture", () => {
    // earnsBonusRoll is boolean by construction — there is no "count" to stack.
    expect(earnsBonusRoll(6, captureMove, DEFAULT_ROOM_RULES)).toBe(true);
  });

  it("grants a bonus roll for getting a pawn home under the default rules", () => {
    expect(earnsBonusRoll(3, finishMove, DEFAULT_ROOM_RULES)).toBe(true);
  });

  it("grants one bonus roll, not two, for getting a pawn home with a six", () => {
    expect(earnsBonusRoll(6, finishMove, DEFAULT_ROOM_RULES)).toBe(true);
  });

  it("does not grant a bonus roll for getting a pawn home when the host turned the rule off", () => {
    expect(earnsBonusRoll(3, finishMove, rulesOff)).toBe(false);
  });

  it("grants no bonus roll for a plain non-six, non-capture move", () => {
    expect(earnsBonusRoll(3, plainMove, DEFAULT_ROOM_RULES)).toBe(false);
  });
});

describe("resolveRoomRules", () => {
  it("fills in the defaults when a snapshot has no rules", () => {
    expect(resolveRoomRules(undefined)).toEqual(DEFAULT_ROOM_RULES);
    expect(resolveRoomRules(null)).toEqual(DEFAULT_ROOM_RULES);
  });

  it("keeps a rule the host set", () => {
    expect(resolveRoomRules({ bonusRollOnFinish: false })).toEqual({
      ...DEFAULT_ROOM_RULES,
      bonusRollOnFinish: false,
    });
  });

  it("keeps a shorter game the host set (F2.1)", () => {
    expect(resolveRoomRules({ startOnBoard: 1, pawnsToWin: 2 })).toEqual({
      ...DEFAULT_ROOM_RULES,
      startOnBoard: 1,
      pawnsToWin: 2,
    });
  });
});

describe("evaluateSixRoll — consecutive sixes", () => {
  it("resets the streak on a non-six", () => {
    expect(evaluateSixRoll(2, 4)).toEqual({ consecutiveSixesAfter: 0, cancelMove: false });
  });

  it("increments without cancelling on the first and second six", () => {
    expect(evaluateSixRoll(0, 6)).toEqual({ consecutiveSixesAfter: 1, cancelMove: false });
    expect(evaluateSixRoll(1, 6)).toEqual({ consecutiveSixesAfter: 2, cancelMove: false });
  });

  it("cancels the move on the third consecutive six", () => {
    expect(evaluateSixRoll(2, 6)).toEqual({ consecutiveSixesAfter: 3, cancelMove: true });
  });
});

describe("applyMove", () => {
  it("relocates the moving pawn and sends captured pawns to nest", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "track", 6),
      "green-0": pawn("green-0", "green", 0, "track", 49),
    });
    const move = getLegalMoves(pawns, "red", 4).find((m) => m.pawnId === "red-0")!;
    const next = applyMove(pawns, move);

    const redAfter = next.find((p) => p.id === "red-0")!;
    const greenAfter = next.find((p) => p.id === "green-0")!;
    expect(redAfter).toMatchObject({ state: "track", pathIndex: 10 });
    expect(greenAfter).toMatchObject({ state: "nest", pathIndex: null });
  });

  it("transitions state as a pawn crosses into the home lane and finishes", () => {
    const pawns = makeBoard({ "red-0": pawn("red-0", "red", 0, "track", 49) });
    const intoHomeLane = getLegalMoves(pawns, "red", 3).find((m) => m.pawnId === "red-0")!;
    const afterHomeLane = applyMove(pawns, intoHomeLane).find((p) => p.id === "red-0")!;
    expect(afterHomeLane).toMatchObject({ state: "home_lane", pathIndex: 52 });

    const toFinish = getLegalMoves([afterHomeLane, ...pawns.filter((p) => p.id !== "red-0")], "red", 4).find(
      (m) => m.pawnId === "red-0",
    )!;
    const finished = applyMove([afterHomeLane], toFinish).find((p) => p.id === "red-0")!;
    expect(finished).toMatchObject({ state: "finished", pathIndex: 56 });
  });
});

describe("isMatchWon", () => {
  it("ends a quick game as soon as enough pieces are home (F2.1)", () => {
    const pawns = [
      { id: "a", color: "red" as const, index: 0, state: "finished" as const, pathIndex: 56 },
      { id: "b", color: "red" as const, index: 1, state: "finished" as const, pathIndex: 56 },
      { id: "c", color: "red" as const, index: 2, state: "track" as const, pathIndex: 10 },
      { id: "d", color: "red" as const, index: 3, state: "nest" as const, pathIndex: null },
    ];
    expect(isMatchWon(pawns, "red", { pawnsToWin: 2 })).toBe(true);
    expect(isMatchWon(pawns, "red")).toBe(false);
  });

  it("is false until all 4 pawns of a color are finished", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "finished", 56),
      "red-1": pawn("red-1", "red", 1, "finished", 56),
      "red-2": pawn("red-2", "red", 2, "finished", 56),
    });
    expect(isMatchWon(pawns, "red")).toBe(false);
  });

  it("is true once all 4 pawns of a color are finished", () => {
    const pawns = makeBoard({
      "red-0": pawn("red-0", "red", 0, "finished", 56),
      "red-1": pawn("red-1", "red", 1, "finished", 56),
      "red-2": pawn("red-2", "red", 2, "finished", 56),
      "red-3": pawn("red-3", "red", 3, "finished", 56),
    });
    expect(isMatchWon(pawns, "red")).toBe(true);
  });
});

describe("rankPlayers — tiebreakers", () => {
  it("ranks by pawns finished, then total progress, then earlier turn order", () => {
    const ranked = rankPlayers([
      { id: "a", pawnsFinished: 1, totalProgress: 40, turnOrder: 2 },
      { id: "b", pawnsFinished: 2, totalProgress: 10, turnOrder: 1 },
      { id: "c", pawnsFinished: 1, totalProgress: 50, turnOrder: 0 },
      { id: "d", pawnsFinished: 1, totalProgress: 50, turnOrder: 3 },
    ]);
    expect(ranked).toEqual(["b", "c", "d", "a"]);
  });
});
