import { describe, expect, it } from "vitest";
import {
  PATH_INDEX,
  SAFE_CELLS,
  deriveStateFromPathIndex,
  pathIndexToGlobalCell,
  pathIndexToTileId,
  tileIdToPathIndex,
} from "../../lib/board/geometry";

describe("board geometry", () => {
  it("has exactly 8 safe cells (2 per color, 3 and 8 steps after entry), per designs/board-design.png", () => {
    expect(SAFE_CELLS.size).toBe(8);
  });

  it("places each color's 3rd and 8th step on the safe set, not the bare entry cell itself", () => {
    expect(pathIndexToGlobalCell("red", 0)).toBe(0);
    expect(pathIndexToGlobalCell("green", 0)).toBe(13);
    expect(pathIndexToGlobalCell("yellow", 0)).toBe(26);
    expect(pathIndexToGlobalCell("blue", 0)).toBe(39);
    for (const entry of [0, 13, 26, 39]) {
      expect(SAFE_CELLS.has(entry)).toBe(false);
      expect(SAFE_CELLS.has((entry + 3) % 52)).toBe(true);
      expect(SAFE_CELLS.has((entry + 8) % 52)).toBe(true);
    }
  });

  it("round-trips pathIndex <-> tileId for nest, track, and home-lane positions", () => {
    for (const color of ["red", "green", "yellow", "blue"] as const) {
      for (const pathIndex of [null, 0, 25, 50, 51, 55, 56]) {
        const tileId = pathIndexToTileId(color, pathIndex);
        expect(tileIdToPathIndex(color, tileId)).toBe(pathIndex);
      }
    }
  });

  it("throws when converting a pathIndex out of the 0-50 shared-track range", () => {
    expect(() => pathIndexToGlobalCell("red", 51)).toThrow();
    expect(() => pathIndexToGlobalCell("red", -1)).toThrow();
  });

  it("derives PawnState from pathIndex at every boundary", () => {
    expect(deriveStateFromPathIndex(null)).toBe("nest");
    expect(deriveStateFromPathIndex(PATH_INDEX.LAST_TRACK_CELL)).toBe("track");
    expect(deriveStateFromPathIndex(PATH_INDEX.HOME_LANE_START)).toBe("home_lane");
    expect(deriveStateFromPathIndex(PATH_INDEX.FINISHED - 1)).toBe("home_lane");
    expect(deriveStateFromPathIndex(PATH_INDEX.FINISHED)).toBe("finished");
  });
});
