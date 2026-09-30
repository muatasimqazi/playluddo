"use client";

/**
 * F5.1 Localization — React context, provider, and hooks.
 *
 * Detection is client-side by design: the Capacitor build is a fully static
 * export (next.config.ts `output: "export"`) with no server to run a proxy or
 * per-locale SSR, and the web build isn't rendered per-locale either. So the
 * server always emits the English (default) HTML, and we switch to the
 * player's locale right after mount. This keeps one code path for native and
 * web and matches the roadmap's "guests keep working" convention.
 *
 * To avoid a hydration mismatch, the very first client render uses the same
 * default locale the server rendered; a mount effect then applies the stored
 * or browser-preferred locale. This can briefly flash English/LTR before the
 * effect runs — an accepted tradeoff of static export without locale routing.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  directionFor,
  type Direction,
  type LocaleCode,
} from "./locales";
import { detectLocale, persistLocale, applyDocumentLocale } from "./preferences";
import { getMessages } from "./dictionaries";
import { createTranslator } from "./translate";
import type { Translator } from "./types";

interface I18nContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  dir: Direction;
  t: Translator;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Start at the default so the first client render matches the server HTML.
  const [locale, setLocaleState] = useState<LocaleCode>(DEFAULT_LOCALE);

  // After mount, adopt the stored/browser-preferred locale (one re-render).
  // Deferring one frame keeps the hydration render at the server's default and
  // avoids a synchronous state update from an effect.
  useEffect(() => {
    const detected = detectLocale();
    if (detected === DEFAULT_LOCALE) return;
    const frame = window.requestAnimationFrame(() => setLocaleState(detected));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Mirror the active locale onto <html> for the browser, CSS `[dir]` rules,
  // and assistive tech. Done in an effect so it never races hydration.
  useEffect(() => {
    applyDocumentLocale(document.documentElement, locale);
  }, [locale]);

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next);
    persistLocale(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      dir: directionFor(locale),
      t: createTranslator(getMessages(locale)),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}

/** Convenience hook for components that only need the translator. */
export function useT(): Translator {
  return useI18n().t;
}
