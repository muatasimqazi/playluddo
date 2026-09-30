/**
 * F5.1 Localization — supported locales for the first wave.
 *
 * Chosen for our own target markets (South Asia, the Middle East, Southeast
 * Asia), per docs/COMPETITIVE_ROADMAP.md F5.1 — not a verified competitor gap.
 *
 * `dir` drives the document's writing direction: Urdu and Arabic are
 * right-to-left. The 3D scene is unaffected by direction; only the HUD and
 * panels mirror (F5.1 acceptance).
 */
export type Direction = "ltr" | "rtl";

export interface LocaleMeta {
  /** BCP 47 code used in localStorage, <html lang>, and Accept-Language matching. */
  code: string;
  /** Name in English, for settings/debugging. */
  englishName: string;
  /** Endonym — how speakers name their own language, shown in the picker. */
  nativeName: string;
  dir: Direction;
}

/**
 * The default and source-of-truth locale. Every other catalog falls back to
 * English key-by-key (see dictionaries.ts), so English must be complete.
 */
export const DEFAULT_LOCALE = "en";

/**
 * First wave. English leads; the rest are the F5.1 launch languages.
 * Order here is the order the language picker shows them in.
 */
export const LOCALES = [
  { code: "en", englishName: "English", nativeName: "English", dir: "ltr" },
  { code: "hi", englishName: "Hindi", nativeName: "हिन्दी", dir: "ltr" },
  { code: "ur", englishName: "Urdu", nativeName: "اردو", dir: "rtl" },
  { code: "ar", englishName: "Arabic", nativeName: "العربية", dir: "rtl" },
  { code: "bn", englishName: "Bengali", nativeName: "বাংলা", dir: "ltr" },
  { code: "id", englishName: "Indonesian", nativeName: "Bahasa Indonesia", dir: "ltr" },
  { code: "es", englishName: "Spanish", nativeName: "Español", dir: "ltr" },
  { code: "pt-BR", englishName: "Portuguese (Brazil)", nativeName: "Português (Brasil)", dir: "ltr" },
] as const satisfies readonly LocaleMeta[];

export type LocaleCode = (typeof LOCALES)[number]["code"];

// Widen map lookup inputs to arbitrary strings while retaining the locale
// union above for callers that have already passed the guard.
const BY_CODE: ReadonlyMap<string, LocaleMeta> = new Map(
  LOCALES.map((l) => [l.code, l]),
);

export function isSupportedLocale(code: string): code is LocaleCode {
  return BY_CODE.has(code);
}

export function localeMeta(code: string): LocaleMeta {
  return BY_CODE.get(code) ?? BY_CODE.get(DEFAULT_LOCALE)!;
}

export function directionFor(code: string): Direction {
  return localeMeta(code).dir;
}

/**
 * Resolve an arbitrary language tag (e.g. from navigator.language or a stored
 * value) to a supported locale. Tries the exact tag, then its base language
 * (`pt-BR` → `pt`), then returns null so callers can fall back to the default.
 *
 * `pt` maps to `pt-BR` because Brazilian Portuguese is our launch variant.
 */
export function matchLocale(tag: string | null | undefined): LocaleCode | null {
  if (!tag) return null;
  const normalized = tag.trim();
  if (!normalized) return null;
  if (isSupportedLocale(normalized)) return normalized;

  const lower = normalized.toLowerCase();
  // Exact, case-insensitive (covers "PT-br", "AR", …).
  for (const l of LOCALES) {
    if (l.code.toLowerCase() === lower) return l.code;
  }
  const base = lower.split("-")[0];
  if (base === "pt") return "pt-BR";
  for (const l of LOCALES) {
    if (l.code.toLowerCase().split("-")[0] === base) return l.code;
  }
  return null;
}

/**
 * Best supported locale for a list of candidate tags, most-preferred first
 * (e.g. navigator.languages). Falls back to the default locale.
 */
export function resolveLocale(candidates: readonly (string | null | undefined)[]): LocaleCode {
  for (const candidate of candidates) {
    const matched = matchLocale(candidate);
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}

/** localStorage key holding the player's explicit language choice. */
export const LOCALE_STORAGE_KEY = "luddo-locale";
