import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptPartyRules, partyRulesAccepted, acceptTableRules, tableRulesAccepted } from "../../lib/community";

beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
it("short Party acceptance still requires the full agreement at a chat/voice table", () => {
  acceptPartyRules();
  expect(partyRulesAccepted()).toBe(true);
  expect(tableRulesAccepted()).toBe(false);
  acceptTableRules();
  expect(tableRulesAccepted()).toBe(true);
  expect(partyRulesAccepted()).toBe(true);
});
it("full acceptance and short acceptance are separate versioned records", () => {
  acceptTableRules();
  expect(partyRulesAccepted()).toBe(false);
});
it("unavailable device storage asks again without crashing", () => {
  vi.stubGlobal("localStorage", { getItem() { throw new Error("private"); }, setItem() { throw new Error("private"); } });
  expect(() => acceptPartyRules()).not.toThrow();
  expect(partyRulesAccepted()).toBe(false);
});
