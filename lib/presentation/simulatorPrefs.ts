import { BOT_LEVELS, type BotLevel } from "../board/bot";

export type BoardStyle = "signature" | "classic" | "geometric" | "aladdin";

// Shared with components/simulator/Simulator.tsx's own PREF_KEY/loadPreferences —
// this is the single place that name is allowed to appear as a literal.
export const SIMULATOR_PREF_KEY = "luddo-simulator-v1";

// Lets the entrance page set a board design ahead of the first game,
// without duplicating Simulator's whole Preferences shape here. Merges
// into whatever's already saved so it doesn't clobber a returning
// player's other saved prefs (quality, sound, camera orientation, etc).
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
