import { describe, expect, it } from "vitest";
import { diceSkinFor } from "../../lib/presentation/diceSkins";

describe("diceSkinFor", () => {
  it("maps each dice cosmetic in the catalog to its skin", () => {
    expect(diceSkinFor("dice_classic")).toBe("classic");
    expect(diceSkinFor("dice_glass")).toBe("glass");
    expect(diceSkinFor("dice_wood")).toBe("wood");
    expect(diceSkinFor("dice_marble")).toBe("marble");
  });

  it("falls back to the classic die with nothing, or something unknown, equipped", () => {
    expect(diceSkinFor(undefined)).toBe("classic");
    expect(diceSkinFor("")).toBe("classic");
    expect(diceSkinFor("dice_from_a_newer_catalog")).toBe("classic");
    expect(diceSkinFor("board_classic")).toBe("classic");
  });
});
