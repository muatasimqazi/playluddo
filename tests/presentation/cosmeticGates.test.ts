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
    for (const style of ["signature", "classic", "geometric", "aladdin", "bazaar", "rug", "mosaic"] as const) {
      expect(boardStyleForCosmetic(boardCosmetic(style))).toBe(style);
    }
    for (const room of ROOM_STYLES) {
      expect(roomForCosmetic(roomCosmetic(room))).toBe(room);
    }
    expect(roomForCosmetic("room_trophy")).toBeUndefined();
    expect(boardStyleForCosmetic("dice_wood")).toBeUndefined();
  });

  it("keeps every board free, and the Apartment", () => {
    for (const style of ["signature", "classic", "geometric", "aladdin", "bazaar", "rug", "mosaic"] as const)
      expect(ownedBoardStyle(style, freeOnly)).toBe(style);
    expect(ownedRoom("apartment", freeOnly)).toBe("apartment");
  });

  it("draws an unowned choice as the free default", () => {
    // No board is locked today; one that is later falls back to Classic.
    expect(ownedBoardStyle("bazaar", () => false)).toBe("classic");
    for (const room of ["mahogany", "cafe", "lake", "rooftop"] as const) {
      expect(ownedRoom(room, freeOnly)).toBe("apartment");
    }
  });

  it("draws an owned choice as chosen", () => {
    const owns = (id: string) => freeOnly(id) || id === "room_cafe";
    expect(ownedRoom("cafe", owns)).toBe("cafe");
    expect(ownedRoom("lake", owns)).toBe("apartment");
  });
});
