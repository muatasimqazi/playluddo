import { describe, expect, it } from "vitest";
import {
  boardCosmetic,
  boardStyleForCosmetic,
  FREE_COSMETICS,
  ownedBoardStyle,
  ownedRoom,
  roomCosmetic,
  roomForCosmetic,
} from "../../lib/presentation/cosmeticGates";
import { ROOM_STYLES } from "../../lib/presentation/simulatorPrefs";

const freeOnly = (id: string) => FREE_COSMETICS.has(id);

describe("cosmetic gates", () => {
  it("maps every board and room to a catalog cosmetic and back", () => {
    for (const style of ["signature", "classic", "geometric", "aladdin"] as const) {
      expect(boardStyleForCosmetic(boardCosmetic(style))).toBe(style);
    }
    for (const room of ROOM_STYLES) {
      expect(roomForCosmetic(roomCosmetic(room))).toBe(room);
    }
    expect(roomForCosmetic("room_trophy")).toBeUndefined();
    expect(boardStyleForCosmetic("dice_wood")).toBeUndefined();
  });

  it("keeps the shipped defaults free: Classic and Signature boards, the Apartment", () => {
    expect(ownedBoardStyle("classic", freeOnly)).toBe("classic");
    expect(ownedBoardStyle("signature", freeOnly)).toBe("signature");
    expect(ownedRoom("apartment", freeOnly)).toBe("apartment");
  });

  it("draws an unowned choice as the free default", () => {
    expect(ownedBoardStyle("geometric", freeOnly)).toBe("classic");
    expect(ownedBoardStyle("aladdin", freeOnly)).toBe("classic");
    for (const room of ["mahogany", "cafe", "lake", "rooftop"] as const) {
      expect(ownedRoom(room, freeOnly)).toBe("apartment");
    }
  });

  it("draws an owned choice as chosen", () => {
    const owns = (id: string) => freeOnly(id) || id === "board_geometric" || id === "room_cafe";
    expect(ownedBoardStyle("geometric", owns)).toBe("geometric");
    expect(ownedRoom("cafe", owns)).toBe("cafe");
    expect(ownedRoom("lake", owns)).toBe("apartment");
  });
});
