/** Complete catalogs: a supported locale never merges with English. */
import { en } from "./messages/en";
import { es } from "./messages/es";
import { ptBR } from "./messages/pt-BR";
import { id } from "./messages/id";
import { hi } from "./messages/hi";
import { bn } from "./messages/bn";
import { ar } from "./messages/ar";
import { ur } from "./messages/ur";
import { DEFAULT_LOCALE, isSupportedLocale, type LocaleCode } from "./locales";
import type { Messages } from "./types";

export const catalogs: Record<LocaleCode, Messages> = {
  en, es, "pt-BR": ptBR, id, hi, bn, ar, ur,
};

/** Unknown locales use the default; supported locales always use their own catalog. */
export function getMessages(locale: string): Messages {
  return catalogs[isSupportedLocale(locale) ? locale : DEFAULT_LOCALE];
}
