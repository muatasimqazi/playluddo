/**
 * F5.1 Localization — types derived from the English source catalog.
 */
import type { en } from "./messages/en";

/** The full message shape. Every catalog is a DeepPartial of this. */
export type Messages = typeof en;

/** Recursively-optional version, so a language may translate only some keys. */
export type PartialMessages = DeepPartial<Messages>;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Dotted key paths to every string leaf, e.g. "entrance.chooseGame".
 * This gives `t()` autocomplete and compile-time safety against typos.
 */
export type MessageKey = DotKeys<Messages>;

type DotKeys<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotKeys<T[K]>}`;
}[keyof T & string];

/** Values interpolated into a message's `{placeholder}` slots. */
export type TranslationValues = Record<string, string | number>;

/** The translator returned by useI18n()/getTranslator(). */
export type Translator = (key: MessageKey, values?: TranslationValues) => string;
