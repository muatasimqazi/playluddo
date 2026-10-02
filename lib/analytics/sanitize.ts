/**
 * Cleans an event's parameters before they leave the page: only flat
 * strings, finite numbers and booleans survive, strings are capped at GA4's
 * 100-character limit, and `undefined`, `null`, `NaN`, objects and arrays are
 * dropped rather than sent as "undefined" or "[object Object]".
 */

export type CleanValue = string | number | boolean;
export type CleanParams = Record<string, CleanValue>;

export const MAX_STRING_LENGTH = 100;
/** GA4 accepts at most 25 custom parameters per event. */
export const MAX_PARAMETERS = 25;

export function sanitize(params: object | undefined): CleanParams {
  const clean: CleanParams = {};
  if (!params) return clean;
  let count = 0;
  for (const key of Object.keys(params)) {
    if (count >= MAX_PARAMETERS) break;
    const value = (params as Record<string, unknown>)[key];
    if (typeof value === "string") {
      if (!value) continue;
      clean[key] = value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      clean[key] = value;
    } else if (typeof value === "boolean") {
      clean[key] = value;
    } else {
      continue;
    }
    count += 1;
  }
  return clean;
}
