import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, directionFor, isSupportedLocale, resolveLocale, type LocaleCode } from "./locales";

type LocaleStorage = Pick<Storage, "getItem" | "setItem">;

/** Storage can throw in private mode, both when accessed and when used. */
function browserStorage(): LocaleStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function detectLocale(
  storage = browserStorage(),
  languages: readonly string[] = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? []), navigator.language],
): LocaleCode {
  try {
    const stored = storage?.getItem(LOCALE_STORAGE_KEY);
    if (stored && isSupportedLocale(stored)) return stored;
  } catch { /* A blocked store must not prevent browser language detection. */ }
  return resolveLocale(languages) ?? DEFAULT_LOCALE;
}

export function persistLocale(locale: LocaleCode, storage = browserStorage()): void {
  try { storage?.setItem(LOCALE_STORAGE_KEY, locale); }
  catch { /* The session remains usable without persistent storage. */ }
}

export function applyDocumentLocale(root: { lang: string; dir: string }, locale: LocaleCode): void {
  root.lang = locale;
  root.dir = directionFor(locale);
}
