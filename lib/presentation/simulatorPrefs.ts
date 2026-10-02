import { BOT_LEVELS, type BotLevel } from "../board/bot";

export type BoardStyle = "signature" | "classic" | "geometric" | "aladdin" | "bazaar";

// Shared with components/simulator/Simulator.tsx's own PREF_KEY/loadPreferences —
// this is the single place that name is allowed to appear as a literal.
export const SIMULATOR_PREF_KEY = "luddo-simulator-v1";

// Lets the entrance page set a board design ahead of the first game,
// without duplicating Simulator's whole Preferences shape here. Merges
// into whatever's already saved so it doesn't clobber a returning
// player's other saved prefs (quality, sound, camera orientation, etc).
const BOARD_STYLES: BoardStyle[] = ["signature", "classic", "geometric", "aladdin", "bazaar"];

// Classic is the out-of-the-box board (docs entrance default). Kept in step
// with Simulator's own loadPreferences fallback so the entrance shows — and
// launches — the same board the table will render.
export const DEFAULT_BOARD_STYLE: BoardStyle = "classic";

// What the table will actually render, so the entrance's shown selection
// matches it. A returning player's saved pick wins; otherwise Classic.
export function preferredBoardStyle(): BoardStyle {
  try {
    const saved = JSON.parse(
      localStorage.getItem(SIMULATOR_PREF_KEY) ?? "null",
    )?.boardStyle;
    return BOARD_STYLES.includes(saved) ? saved : DEFAULT_BOARD_STYLE;
  } catch {
    return DEFAULT_BOARD_STYLE;
  }
}

export function setPreferredBoardStyle(boardStyle: BoardStyle) {
  try {
    const existing = JSON.parse(
      localStorage.getItem(SIMULATOR_PREF_KEY) ?? "null",
    );
    localStorage.setItem(
      SIMULATOR_PREF_KEY,
      JSON.stringify({ ...existing, boardStyle }),
    );
  } catch {}
}

// The offline computer level last picked on this device (F1.4).
const BOT_LEVEL_KEY = "luddo-bot-level";

export function preferredBotLevel(): BotLevel {
  try {
    const saved = localStorage.getItem(BOT_LEVEL_KEY);
    return BOT_LEVELS.includes(saved as BotLevel) ? (saved as BotLevel) : "normal";
  } catch {
    return "normal";
  }
}

export function setPreferredBotLevel(level: BotLevel) {
  try {
    localStorage.setItem(BOT_LEVEL_KEY, level);
  } catch {}
}

// The room around the table. Kept apart from the simulator's own JSON blob,
// like the bot level, since the entrance and replays read it too.
export type RoomStyle = "apartment" | "mahogany" | "cafe" | "lake" | "rooftop";
export const ROOM_STYLES: RoomStyle[] = ["apartment", "mahogany", "cafe", "lake", "rooftop"];
export const DEFAULT_ROOM_STYLE: RoomStyle = "apartment";
const ROOM_STYLE_KEY = "luddo-room";

export function preferredRoomStyle(): RoomStyle {
  try {
    const saved = localStorage.getItem(ROOM_STYLE_KEY);
    return ROOM_STYLES.includes(saved as RoomStyle) ? (saved as RoomStyle) : DEFAULT_ROOM_STYLE;
  } catch {
    return DEFAULT_ROOM_STYLE;
  }
}

export function setPreferredRoomStyle(room: RoomStyle) {
  try {
    localStorage.setItem(ROOM_STYLE_KEY, room);
  } catch {}
}
