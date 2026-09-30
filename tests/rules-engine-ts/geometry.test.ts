import { describe, expect, it } from "vitest";
import {
  PATH_INDEX,
  SAFE_CELLS,
  deriveStateFromPathIndex,
  pathIndexToGlobalCell,
  pathIndexToTileId,
  tileIdToPathIndex,
} from "../../lib/board/geometry";
import { BOARD_4, BOARD_6, boardSpecForPlayers } from "../../lib/board/boardSpec";

describe("board geometry", () => {
  it("has exactly 8 safe cells (2 per color: its own entry, and 8 steps after entry)", () => {
    expect(SAFE_CELLS.size).toBe(8);
  });

  it("places each color's entry cell and 8th step on the safe set", () => {
    expect(pathIndexToGlobalCell("red", 0)).toBe(0);
    expect(pathIndexToGlobalCell("green", 0)).toBe(13);
    expect(pathIndexToGlobalCell("yellow", 0)).toBe(26);
    expect(pathIndexToGlobalCell("blue", 0)).toBe(39);
    for (const entry of [0, 13, 26, 39]) {
      expect(SAFE_CELLS.has(entry)).toBe(true);
      expect(SAFE_CELLS.has((entry + 8) % 52)).toBe(true);
      expect(SAFE_CELLS.has((entry + 3) % 52)).toBe(false);
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

describe("hexagonal board spec (F5.2, 5-6 players)", () => {
  it("keeps the 4-arm spec identical to the historical constants", () => {
    expect(BOARD_4.trackLength).toBe(52);
    expect([...BOARD_4.safeCells].sort((a, b) => a - b)).toEqual([
      0, 8, 13, 21, 26, 34, 39, 47,
    ]);
    expect(BOARD_4.pathIndex).toEqual({
      ENTRY: 0,
      LAST_TRACK_CELL: 50,
      HOME_LANE_START: 51,
      FINISHED: 56,
    });
  });

  it("derives a 6-arm board of 78 cells with entries every 13", () => {
    expect(BOARD_6.trackLength).toBe(78);
    expect(BOARD_6.colors).toEqual([
      "red",
      "green",
      "yellow",
      "blue",
      "orange",
      "black",
    ]);
    for (let arm = 0; arm < 6; arm++) {
      const color = BOARD_6.colors[arm];
      expect(pathIndexToGlobalCell(color, 0, BOARD_6)).toBe(arm * 13);
      expect(BOARD_6.safeCells.has(arm * 13)).toBe(true);
      expect(BOARD_6.safeCells.has(arm * 13 + 8)).toBe(true);
      expect(BOARD_6.safeCells.has(arm * 13 + 3)).toBe(false);
    }
    expect(BOARD_6.safeCells.size).toBe(12);
    expect(BOARD_6.pathIndex).toEqual({
      ENTRY: 0,
      LAST_TRACK_CELL: 76,
      HOME_LANE_START: 77,
      FINISHED: 82,
    });
  });

  it("round-trips pathIndex <-> tileId for the new hex colours", () => {
    for (const color of ["orange", "black"] as const) {
      for (const pathIndex of [null, 0, 40, 76, 77, 81, 82]) {
        const tileId = pathIndexToTileId(color, pathIndex, BOARD_6);
        expect(tileIdToPathIndex(color, tileId, BOARD_6)).toBe(pathIndex);
      }
    }
  });

  it("selects the hex board only for 5-6 seats", () => {
    expect(boardSpecForPlayers(2)).toBe(BOARD_4);
    expect(boardSpecForPlayers(4)).toBe(BOARD_4);
    expect(boardSpecForPlayers(5)).toBe(BOARD_6);
    expect(boardSpecForPlayers(6)).toBe(BOARD_6);
  });
});
