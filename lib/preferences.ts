/**
 * User preferences that follow the player across devices.
 *
 * Two backing stores, one API:
 *   - Signed-in (non-anonymous) accounts persist to Supabase Auth
 *     `user_metadata` (the same place the profile's name/avatar/country live),
 *     so a preference set on a phone shows up on the TV and the web.
 *   - Guests (anonymous sessions) persist to localStorage only.
 *
 * On sign-in the two are reconciled (see components/preferences/PreferencesSync):
 * a value already saved to the account wins, and a guest's local choice is
 * uploaded when the account has none yet, so nothing a guest set is lost when
 * they finally make an account.
 *
 * Locale is a preference too, but its live value is owned by the i18n context
 * (lib/i18n) so language switches apply instantly; only its persistence and
 * cross-device sync route through here. The others ("game" preferences, and
 * the accessibility settings of F5.5) live in the small reactive store below
 * so every screen reflects an account's saved choices the moment sign-in
 * reconciles them.
 */
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import { isSupportedLocale, LOCALE_STORAGE_KEY, type LocaleCode } from "./i18n/locales";
import type { PlayerColor } from "./board/types";
import { BOT_LEVELS, type BotLevel } from "./board/bot";
import {
  DEFAULT_BOARD_STYLE,
  DEFAULT_ROOM_STYLE,
  preferredBoardStyle,
  preferredBotLevel,
  preferredRoomStyle,
  ROOM_STYLES,
  setPreferredBoardStyle,
  setPreferredBotLevel,
  setPreferredRoomStyle,
  type BoardStyle,
  type RoomStyle,
} from "./presentation/simulatorPrefs";

/** Every preference this module manages. */
export interface UserPreferences {
  locale: LocaleCode;
  baseColor: PlayerColor;
  boardStyle: BoardStyle;
  /** The room around the table. */
  room: RoomStyle;
  botLevel: BotLevel;
  /** F5.5: the colour-blind palette, plus symbols on pawns and bases. */
  colorBlind: boolean;
  /** F5.5: still the table even when the device doesn't ask for reduced motion. */
  reduceMotion: boolean;
}

/** The preferences the reactive store owns (locale is the i18n context's). */
export type GamePreferenceKey = Exclude<keyof UserPreferences, "locale">;
export const GAME_PREFERENCE_KEYS: GamePreferenceKey[] = [
  "baseColor",
  "boardStyle",
  "room",
  "botLevel",
  "colorBlind",
  "reduceMotion",
];

// Orange and black are hex-board seats (F5.2); a favourite of either is
// clamped to a real seat when the table is smaller (see app/page.tsx).
const PLAYER_COLORS: PlayerColor[] = ["red", "green", "yellow", "blue", "orange", "black"];
export const DEFAULT_BASE_COLOR: PlayerColor = "red";
export const DEFAULT_BOT_LEVEL: BotLevel = "normal";
const BASE_COLOR_KEY = "luddo-base-color";
const ACCESSIBILITY_KEY = "luddo-accessibility";

/** The `user_metadata` field each preference is stored under, kept distinct
 * from the profile's own keys (display_name, avatar_id, country, …). */
const METADATA_FIELD: Record<keyof UserPreferences, string> = {
  locale: "pref_locale",
  baseColor: "pref_base_color",
  boardStyle: "pref_board_style",
  room: "pref_room",
  botLevel: "pref_bot_level",
  colorBlind: "pref_color_blind",
  reduceMotion: "pref_reduce_motion",
};

function isPlayerColor(value: unknown): value is PlayerColor {
  return typeof value === "string" && PLAYER_COLORS.includes(value as PlayerColor);
}
function isBotLevel(value: unknown): value is BotLevel {
  return typeof value === "string" && BOT_LEVELS.includes(value as BotLevel);
}
function isBoardStyle(value: unknown): value is BoardStyle {
  return (
    value === "signature" ||
    value === "classic" ||
    value === "geometric" ||
    value === "aladdin" ||
    value === "bazaar" ||
    value === "rug" ||
    value === "mosaic"
  );
}

function isRoomStyle(value: unknown): value is RoomStyle {
  return ROOM_STYLES.includes(value as RoomStyle);
}

/** Preferences are only synced for a real account; a guest's anonymous session
 * keeps them on the device. */
export function isSignedIn(user: User | null | undefined): boolean {
  return !!user && !user.is_anonymous;
}

// --- Local (device) storage ------------------------------------------------

function readBaseColor(): PlayerColor {
  try {
    const saved = localStorage.getItem(BASE_COLOR_KEY);
    return isPlayerColor(saved) ? saved : DEFAULT_BASE_COLOR;
  } catch {
    return DEFAULT_BASE_COLOR;
  }
}
function writeBaseColor(color: PlayerColor) {
  try {
    localStorage.setItem(BASE_COLOR_KEY, color);
  } catch {}
}
type AccessibilityKey = "colorBlind" | "reduceMotion";
function readAccessibility(key: AccessibilityKey): boolean {
  try {
    return JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY) ?? "null")?.[key] === true;
  } catch {
    return false;
  }
}
function writeAccessibility(key: AccessibilityKey, value: boolean) {
  try {
    const existing = JSON.parse(localStorage.getItem(ACCESSIBILITY_KEY) ?? "null");
    localStorage.setItem(ACCESSIBILITY_KEY, JSON.stringify({ ...existing, [key]: value }));
  } catch {}
}
/** Read one game preference from the device — the very same localStorage keys
 * the game already reads, so board style and bot level stay in one place. */
function readLocalGamePreference<K extends GamePreferenceKey>(key: K): UserPreferences[K] {
  switch (key) {
    case "baseColor":
      return readBaseColor() as UserPreferences[K];
    case "boardStyle":
      return preferredBoardStyle() as UserPreferences[K];
    case "room":
      return preferredRoomStyle() as UserPreferences[K];
    case "botLevel":
      return preferredBotLevel() as UserPreferences[K];
    case "colorBlind":
    case "reduceMotion":
      return readAccessibility(key) as UserPreferences[K];
    default:
      throw new Error(`Unknown preference: ${key as string}`);
  }
}

/** Write one game preference to the device. */
function writeLocalGamePreference<K extends GamePreferenceKey>(key: K, value: UserPreferences[K]) {
  switch (key) {
    case "baseColor":
      return writeBaseColor(value as PlayerColor);
    case "boardStyle":
      return setPreferredBoardStyle(value as BoardStyle);
    case "room":
      return setPreferredRoomStyle(value as RoomStyle);
    case "botLevel":
      return setPreferredBotLevel(value as BotLevel);
    case "colorBlind":
    case "reduceMotion":
      return writeAccessibility(key, value as boolean);
  }
}

function defaultGamePreference<K extends GamePreferenceKey>(key: K): UserPreferences[K] {
  const defaults: Pick<UserPreferences, GamePreferenceKey> = {
    baseColor: DEFAULT_BASE_COLOR,
    boardStyle: DEFAULT_BOARD_STYLE,
    room: DEFAULT_ROOM_STYLE,
    botLevel: DEFAULT_BOT_LEVEL,
    colorBlind: false,
    reduceMotion: false,
  };
  return defaults[key] as UserPreferences[K];
}

// --- Account (user_metadata) mapping --------------------------------------

/** Pull whatever valid preferences an account has saved out of its metadata. */
export function preferencesFromMetadata(
  metadata: Record<string, unknown> | undefined,
): Partial<UserPreferences> {
  if (!metadata) return {};
  const out: Partial<UserPreferences> = {};
  const locale = metadata[METADATA_FIELD.locale];
  if (typeof locale === "string" && isSupportedLocale(locale)) out.locale = locale;
  const baseColor = metadata[METADATA_FIELD.baseColor];
  if (isPlayerColor(baseColor)) out.baseColor = baseColor;
  const boardStyle = metadata[METADATA_FIELD.boardStyle];
  if (isBoardStyle(boardStyle)) out.boardStyle = boardStyle;
  const room = metadata[METADATA_FIELD.room];
  if (isRoomStyle(room)) out.room = room;
  const botLevel = metadata[METADATA_FIELD.botLevel];
  if (isBotLevel(botLevel)) out.botLevel = botLevel;
  const colorBlind = metadata[METADATA_FIELD.colorBlind];
  if (typeof colorBlind === "boolean") out.colorBlind = colorBlind;
  const reduceMotion = metadata[METADATA_FIELD.reduceMotion];
  if (typeof reduceMotion === "boolean") out.reduceMotion = reduceMotion;
  return out;
}

/** Turn a set of preferences into the metadata patch `auth.updateUser` expects. */
function metadataPatch(prefs: Partial<UserPreferences>): Record<string, string | boolean> {
  const patch: Record<string, string | boolean> = {};
  for (const key of Object.keys(prefs) as (keyof UserPreferences)[]) {
    const value = prefs[key];
    if (value !== undefined) patch[METADATA_FIELD[key]] = value;
  }
  return patch;
}

/** Save preferences to the signed-in account, if any. A guest, a network
 * blip, or a blocked write is a no-op — the device copy is the fallback. */
export async function persistPreferencesToAccount(prefs: Partial<UserPreferences>): Promise<void> {
  if (Object.keys(prefs).length === 0) return;
  try {
    const client = createClient();
    const { data } = await client.auth.getUser();
    if (!isSignedIn(data.user)) return;
    await client.auth.updateUser({ data: metadataPatch(prefs) });
  } catch {
    /* The device copy already holds the change; the account catches up later. */
  }
}

// --- Reactive store for the game preferences --------------------------------

type Listener = () => void;

/** localStorage is per-device, but several components read the same preference
 * at once (the entrance and, after navigation, the table). A tiny in-memory
 * cache with listeners lets them all re-render together the instant a value
 * changes — including when sign-in reconciliation pulls the account's copy in
 * while the entrance is already open. */
class GamePreferenceStore {
  private cache: Pick<UserPreferences, GamePreferenceKey> | null = null;
  private listeners = new Set<Listener>();

  private ensure(): Pick<UserPreferences, GamePreferenceKey> {
    if (!this.cache)
      this.cache = {
        baseColor: readLocalGamePreference("baseColor"),
        boardStyle: readLocalGamePreference("boardStyle"),
        room: readLocalGamePreference("room"),
        botLevel: readLocalGamePreference("botLevel"),
        colorBlind: readLocalGamePreference("colorBlind"),
        reduceMotion: readLocalGamePreference("reduceMotion"),
      };
    return this.cache;
  }

  get<K extends GamePreferenceKey>(key: K): UserPreferences[K] {
    return this.ensure()[key] as UserPreferences[K];
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private commit<K extends GamePreferenceKey>(key: K, value: UserPreferences[K]) {
    const current = this.ensure();
    if (current[key] === value) return false;
    this.cache = { ...current, [key]: value };
    writeLocalGamePreference(key, value);
    for (const listener of this.listeners) listener();
    return true;
  }

  /** A change the player made: save it to the device and, if signed in, the account. */
  set<K extends GamePreferenceKey>(key: K, value: UserPreferences[K]) {
    if (this.commit(key, value)) void persistPreferencesToAccount({ [key]: value });
  }

  /** A value coming down from the account on sign-in: save it to the device
   * without echoing it back up. */
  applyFromAccount<K extends GamePreferenceKey>(key: K, value: UserPreferences[K]) {
    this.commit(key, value);
  }
}

export const gamePreferences = new GamePreferenceStore();

/** For useSyncExternalStore's server snapshot — never touches storage. */
export function defaultGameSnapshot<K extends GamePreferenceKey>(key: K): UserPreferences[K] {
  return defaultGamePreference(key);
}

// --- Locale persistence (the live value is owned by the i18n context) ------

/** Save the chosen language to the account, if signed in. localStorage is
 * already written by the i18n context's own persistLocale. */
export function persistLocalePreference(locale: LocaleCode): void {
  void persistPreferencesToAccount({ locale });
}

export { LOCALE_STORAGE_KEY };
