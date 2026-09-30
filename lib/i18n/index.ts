/**
 * F5.1 Localization — public entry point.
 *
 * Client components: import { useI18n, useT } from "@/lib/i18n".
 * The <I18nProvider> wraps the app in app/layout.tsx.
 */
export { I18nProvider, useI18n, useT } from "./context";
export {
  LOCALES,
  DEFAULT_LOCALE,
  localeMeta,
  directionFor,
  isSupportedLocale,
  matchLocale,
  resolveLocale,
  type LocaleCode,
  type LocaleMeta,
  type Direction,
} from "./locales";
export type { Messages, MessageKey, Translator, TranslationValues } from "./types";
