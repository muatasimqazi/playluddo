import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  PARAMETER_NAMES,
  USER_PROPERTY_NAMES,
  type EventMap,
  type EventName,
} from "../../lib/analytics/events";
import { track } from "../../lib/analytics";

// GA4's collection limits and reserved names.
const RESERVED_PREFIXES = ["ga_", "google_", "firebase_"];
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

describe("event catalog", () => {
  it("lists each event once", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  it("uses names GA4 accepts", () => {
    for (const name of EVENT_NAMES) {
      expect(name).toMatch(SNAKE_CASE);
      expect(name.length).toBeLessThanOrEqual(40);
      expect(RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))).toBe(false);
    }
    for (const name of PARAMETER_NAMES) {
      expect(name).toMatch(SNAKE_CASE);
      expect(name.length).toBeLessThanOrEqual(40);
    }
    for (const name of USER_PROPERTY_NAMES) {
      expect(name).toMatch(SNAKE_CASE);
      expect(name.length).toBeLessThanOrEqual(24);
    }
  });

  it("sends no monetization events", () => {
    for (const name of EVENT_NAMES)
      expect(name).not.toMatch(/purchase|checkout|cart|refund|virtual_currency|ad_|promotion/);
  });

  it("never carries an age, birth date or name", () => {
    for (const name of [...PARAMETER_NAMES, ...USER_PROPERTY_NAMES])
      expect(name).not.toMatch(/(^|_)(age|birth|dob|name|email|phone|room_id|room_code|invite)(_|$)/);
  });

  it("spells the game Luddo in the catalog", () => {
    const source = readFileSync(new URL("../../lib/analytics/events.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bludo\b/i);
  });
});

// Compile-time checks (npx tsc --noEmit): every parameter an event can carry
// has a GTM variable, and track() refuses events and parameters outside the
// catalog. This function never runs.
type KnownKeys<T> = string extends keyof T ? never : keyof T;
type CatalogParameter = { [E in EventName]: KnownKeys<EventMap[E]> }[EventName];
type MissingVariable = Exclude<CatalogParameter, (typeof PARAMETER_NAMES)[number]>;
const everyParameterHasVariable: MissingVariable extends never ? true : MissingVariable = true;

export function typeChecks() {
  // @ts-expect-error not an event in the catalog
  track("purchase", { value: 1 });
  // @ts-expect-error a required parameter is missing
  track("room_created", { game_type: "luddo", seat_count: 4 });
  // @ts-expect-error the engine's spelling is not an analytics value
  track("tournament_created", { size: 8, game_type: "ludo" });
  // @ts-expect-error an age is never a parameter
  track("age_check_completed", { context: "sign_in", age: 12 });
  // @ts-expect-error a room id is never a parameter
  track("room_joined", { play_context: "private_room", entry_point: "created", role: "host", game_type: "luddo", room_id: "x" });
  return everyParameterHasVariable;
}
