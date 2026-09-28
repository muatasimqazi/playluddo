import { describe, expect, it } from "vitest";
import { chooseBotMove, chooseEasyMove, chooseHardMove, chooseMoveForLevel } from "../../lib/board/bot";
import type { EnginePawn } from "../../lib/board/engine-types";
import type { LegalMove, PlayerColor } from "../../lib/board/types";

// Fast correctness checks for the offline difficulty levels. How strong
// each level plays is measured separately: `npm run test:strength`.

function pawn(id: string, color: PlayerColor, index: number, state: EnginePawn["state"], pathIndex: number | null): EnginePawn {
  return { id, color, index, state, pathIndex };
}

const move = (pawnId: string, fromTileId: string | null, toTileId: string, extra: Partial<LegalMove> = {}): LegalMove => ({
  pawnId,
  fromTileId,
  toTileId,
  capturesPawnIds: [],
  finishesPawn: false,
  ...extra,
});

describe("chooseMoveForLevel", () => {
  it("returns null when there's nothing to move", () => {
    for (const level of ["easy", "normal", "hard"] as const)
      expect(chooseMoveForLevel(level, [], [])).toBeNull();
  });

  it("Normal is exactly the online computer's choice", () => {
    const pawns = [pawn("r0", "red", 0, "track", 10), pawn("r1", "red", 1, "track", 20)];
    const moves = [move("r0", "track:10", "track:13"), move("r1", "track:20", "track:23")];
    expect(chooseMoveForLevel("normal", moves, pawns)).toBe(chooseBotMove(moves, pawns));
  });
});

describe("Easy", () => {
  it("only ever picks a legal move", () => {
    const moves = [move("a", "track:1", "track:4"), move("b", "track:5", "track:8")];
    for (let i = 0; i < 50; i++) expect(moves).toContain(chooseEasyMove(moves, Math.random));
  });

  it("leans towards bringing a piece out", () => {
    const exit = move("a", "nest:red:0", "track:0");
    const moves = [exit, move("b", "track:5", "track:11")];
    // A low draw takes the nest-exit branch.
    expect(chooseEasyMove(moves, () => 0.1)).toBe(exit);
  });
});

describe("Hard", () => {
  it("captures a far-travelled opponent rather than making a plain move", () => {
    // Green's pawn is 3 cells past its entry: global cell 16, which is
    // red's pathIndex 16 and not a safe cell. Red on 13 rolling a 3 hits it.
    const pawns = [
      pawn("r0", "red", 0, "track", 13),
      pawn("r1", "red", 1, "track", 30),
      pawn("g0", "green", 0, "track", 3),
    ];
    const capture = move("r0", "track:13", "track:16", { capturesPawnIds: ["g0"] });
    const plain = move("r1", "track:30", "track:33");
    expect(chooseHardMove([plain, capture], pawns)).toBe(capture);
  });

  it("gets a piece home when it can", () => {
    const pawns = [pawn("r0", "red", 0, "home_lane", 53), pawn("r1", "red", 1, "track", 5)];
    const home = move("r0", "home:red:3", "home:red:6", { finishesPawn: true });
    const plain = move("r1", "track:5", "track:8");
    expect(chooseHardMove([plain, home], pawns)).toBe(home);
  });
});
