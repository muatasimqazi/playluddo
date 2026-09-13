import { describe, expect, it } from "vitest";
import { chooseBotMove } from "../../lib/board/bot";
import type { EnginePawn } from "../../lib/board/engine-types";
import type { LegalMove } from "../../lib/board/types";

describe("chooseBotMove — PRD 6.8 priority order", () => {
  it("prefers finishing a pawn over a bigger capture elsewhere", () => {
    const pawns: EnginePawn[] = [
      { id: "red-0", color: "red", index: 0, state: "home_lane", pathIndex: 55 },
      { id: "red-1", color: "red", index: 1, state: "track", pathIndex: 6 },
    ];
    const moves: LegalMove[] = [
      {
        pawnId: "red-1",
        fromTileId: "track:6",
        toTileId: "track:9",
        capturesPawnIds: ["x", "y"],
        finishesPawn: false,
      },
      {
        pawnId: "red-0",
        fromTileId: "home:red:4",
        toTileId: "home:red:5",
        capturesPawnIds: [],
        finishesPawn: true,
      },
    ];
    expect(chooseBotMove(moves, pawns)?.pawnId).toBe("red-0");
  });

  it("prefers more captures over fewer when nothing finishes", () => {
    const pawns: EnginePawn[] = [
      { id: "red-0", color: "red", index: 0, state: "track", pathIndex: 6 },
      { id: "red-1", color: "red", index: 1, state: "track", pathIndex: 6 },
    ];
    const moves: LegalMove[] = [
      {
        pawnId: "red-0",
        fromTileId: "track:6",
        toTileId: "track:9",
        capturesPawnIds: ["x"],
        finishesPawn: false,
      },
      {
        pawnId: "red-1",
        fromTileId: "track:6",
        toTileId: "track:9",
        capturesPawnIds: ["x", "y"],
        finishesPawn: false,
      },
    ];
    expect(chooseBotMove(moves, pawns)?.pawnId).toBe("red-1");
  });

  it("prefers exiting the nest on a 6 over an equally-uneventful track advance", () => {
    const pawns: EnginePawn[] = [
      { id: "red-0", color: "red", index: 0, state: "nest", pathIndex: null },
      { id: "red-1", color: "red", index: 1, state: "track", pathIndex: 44 }, // +6 -> 50, still behind nest-exit's implicit priority
    ];
    const moves: LegalMove[] = [
      {
        pawnId: "red-1",
        fromTileId: "track:44",
        toTileId: "track:50",
        capturesPawnIds: [],
        finishesPawn: false,
      },
      {
        pawnId: "red-0",
        fromTileId: "nest:red",
        toTileId: "track:0",
        capturesPawnIds: [],
        finishesPawn: false,
      },
    ];
    expect(chooseBotMove(moves, pawns)?.pawnId).toBe("red-0");
  });

  it("otherwise advances the pawn closest to finishing", () => {
    const pawns: EnginePawn[] = [
      { id: "red-0", color: "red", index: 0, state: "track", pathIndex: 6 },
      { id: "red-1", color: "red", index: 1, state: "track", pathIndex: 20 },
    ];
    const moves: LegalMove[] = [
      {
        pawnId: "red-0",
        fromTileId: "track:6",
        toTileId: "track:9",
        capturesPawnIds: [],
        finishesPawn: false,
      },
      {
        pawnId: "red-1",
        fromTileId: "track:20",
        toTileId: "track:23",
        capturesPawnIds: [],
        finishesPawn: false,
      },
    ];
    expect(chooseBotMove(moves, pawns)?.pawnId).toBe("red-1");
  });

  it("falls back to stable pawn order when every other tiebreaker is equal", () => {
    const pawns: EnginePawn[] = [
      { id: "red-2", color: "red", index: 2, state: "track", pathIndex: 10 },
      { id: "red-0", color: "red", index: 0, state: "track", pathIndex: 10 },
    ];
    const moves: LegalMove[] = [
      {
        pawnId: "red-2",
        fromTileId: "track:10",
        toTileId: "track:13",
        capturesPawnIds: [],
        finishesPawn: false,
      },
      {
        pawnId: "red-0",
        fromTileId: "track:10",
        toTileId: "track:13",
        capturesPawnIds: [],
        finishesPawn: false,
      },
    ];
    expect(chooseBotMove(moves, pawns)?.pawnId).toBe("red-0"); // lower pawn index wins the tie
  });

  it("returns null when there are no legal moves", () => {
    expect(chooseBotMove([], [])).toBeNull();
  });
});
