import { describe, expect, it } from "vitest";
import { isFigure, pieceStyleFor } from "../../lib/presentation/pieceStyles";

describe("pieceStyleFor", () => {
  it("uses the board's own pieces when the player hasn't chosen a style", () => {
    expect(pieceStyleFor(undefined, "signature", "ludo")).toBe("glass");
    expect(pieceStyleFor(undefined, "geometric", "ludo")).toBe("glass");
    expect(pieceStyleFor(undefined, "classic", "ludo")).toBe("classic");
    expect(pieceStyleFor(undefined, "aladdin", "ludo")).toBe("aladdin");
    expect(pieceStyleFor(undefined, "bazaar", "ludo")).toBe("bazaar");
    expect(pieceStyleFor(undefined, "rug", "ludo")).toBe("rug");
  });

  it("uses the glass discs on the Snakes & Ladders board", () => {
    expect(pieceStyleFor(undefined, "classic", "snakes_and_ladders")).toBe("glass");
  });

  it("puts an equipped piece cosmetic ahead of the board's pieces, in either game", () => {
    expect(pieceStyleFor("piece_wood", "classic", "ludo")).toBe("wood");
    expect(pieceStyleFor("piece_marble", "aladdin", "ludo")).toBe("marble");
    expect(pieceStyleFor("piece_glass", "classic", "ludo")).toBe("glass");
    expect(pieceStyleFor("piece_wood", "signature", "snakes_and_ladders")).toBe("wood");
  });

  it("ignores an unknown cosmetic id", () => {
    expect(pieceStyleFor("piece_from_a_newer_catalog", "classic", "ludo")).toBe("classic");
  });

  it("treats every style but the glass disc as a standing figure", () => {
    expect(isFigure("glass")).toBe(false);
    for (const style of ["classic", "aladdin", "bazaar", "rug", "wood", "marble"] as const) {
      expect(isFigure(style)).toBe(true);
    }
  });
});
