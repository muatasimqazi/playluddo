import {
  DEFAULT_BOARD_STYLE,
  DEFAULT_ROOM_STYLE,
  type BoardStyle,
  type RoomStyle,
} from "./simulatorPrefs";

/**
 * Boards and rooms are earned cosmetics (docs/COMPETITIVE_ROADMAP.md F3.5):
 * each board design and room theme is a catalog cosmetic, and the pickers
 * offer only what the account owns. A saved choice the account doesn't own
 * (an old device preference, a lapsed tester) draws as the free default.
 */

const BOARD_COSMETIC: Record<BoardStyle, string> = {
  signature: "board_signature",
  classic: "board_classic",
  geometric: "board_geometric",
  aladdin: "board_aladdin",
  bazaar: "board_bazaar",
  rug: "board_rug",
  mosaic: "board_mosaic",
  sindbad: "board_sindbad",
  glam: "board_glam",
  cinderella: "board_cinderella",
  bows: "board_bows",
  boba: "board_boba",
};

const ROOM_COSMETIC: Record<RoomStyle, string> = {
  apartment: "room_apartment",
  mahogany: "room_mahogany",
  cafe: "room_cafe",
  lake: "room_lake",
  rooftop: "room_rooftop",
};

/**
 * The catalog's free defaults (unlock rules all null), for when the server
 * can't be asked — no session yet, or offline. Mirrors public.cosmetics.
 */
export const FREE_COSMETICS: ReadonlySet<string> = new Set([
  "board_signature",
  "board_classic",
  "board_geometric",
  "board_aladdin",
  "board_bazaar",
  "board_rug",
  "board_mosaic",
  "board_sindbad",
  "board_glam",
  "board_cinderella",
  "board_bows",
  "board_boba",
  "piece_glass",
  "dice_classic",
  "room_apartment",
  "react_basic",
]);

export function boardCosmetic(style: BoardStyle) {
  return BOARD_COSMETIC[style];
}

export function roomCosmetic(room: RoomStyle) {
  return ROOM_COSMETIC[room];
}

/** The board style a board cosmetic draws, if it is one. */
export function boardStyleForCosmetic(id: string): BoardStyle | undefined {
  return (Object.keys(BOARD_COSMETIC) as BoardStyle[]).find((style) => BOARD_COSMETIC[style] === id);
}

/** The room a room cosmetic draws, if it is one (some catalog rooms aren't built yet). */
export function roomForCosmetic(id: string): RoomStyle | undefined {
  return (Object.keys(ROOM_COSMETIC) as RoomStyle[]).find((room) => ROOM_COSMETIC[room] === id);
}

/** The board to draw: the chosen one if owned, otherwise the free default. */
export function ownedBoardStyle(style: BoardStyle, owns: (id: string) => boolean): BoardStyle {
  return owns(BOARD_COSMETIC[style]) ? style : DEFAULT_BOARD_STYLE;
}

/** The room to draw: the chosen one if owned, otherwise the Apartment. */
export function ownedRoom(room: RoomStyle, owns: (id: string) => boolean): RoomStyle {
  return owns(ROOM_COSMETIC[room]) ? room : DEFAULT_ROOM_STYLE;
}
