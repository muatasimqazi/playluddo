/**
 * F5.1 Localization — pure translation helpers (no React, no DOM), so they
 * can be unit-tested and reused on the server if a route ever needs it.
 */
import type { MessageKey, Messages, TranslationValues, Translator } from "./types";

/** Resolve a dotted key ("entrance.chooseGame") against a catalog object. */
function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === "string" ? node : undefined;
}

/** Replace every `{name}` in a template with values.name (missing → left as-is). */
export function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/**
 * Build a translator bound to an already-merged catalog. Because catalogs are
 * merged over English (see dictionaries.ts), a lookup miss means the key is
 * genuinely absent everywhere — we return the key itself so the gap is visible
 * rather than rendering blank.
 */
export function createTranslator(messages: Messages): Translator {
  return (key: MessageKey, values?: TranslationValues) => {
    const template = lookup(messages, key);
    if (template === undefined) return key;
    return interpolate(template, values);
  };
}
