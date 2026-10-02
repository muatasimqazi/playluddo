import { describe, expect, it } from "vitest";
import { seatColor } from "../../lib/presentation/board";

describe("seatColor — where each player sits around the table", () => {
  it("seats you at the near-left on a Snakes & Ladders table, whatever your colour", () => {
    for (const color of ["red", "green", "yellow", "blue"] as const)
      expect(seatColor(color, "snakes_and_ladders", color)).toBe("blue");
  });

  it("keeps everyone's place around you", () => {
    // Red hosts a duel against yellow: red comes near, yellow goes far.
    expect(seatColor("yellow", "snakes_and_ladders", "red")).toBe("green");
    expect(seatColor("green", "snakes_and_ladders", "red")).toBe("red");
    expect(seatColor("blue", "snakes_and_ladders", "red")).toBe("yellow");
  });

  it("leaves Luddo seats on their bases, since the board turns instead", () => {
    expect(seatColor("red", "ludo", "red")).toBe("red");
  });

  it("leaves a table with no player of its own as it is", () => {
    expect(seatColor("red", "snakes_and_ladders", undefined)).toBe("red");
  });
});
