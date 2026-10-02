import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimOnce, resetDedupeMemory, sentRecord } from "../../lib/analytics/dedupe";
import { fakeBrowser, type FakeWindow } from "./fakeBrowser";

const HOUR = 60 * 60 * 1000;
let win: FakeWindow;

beforeEach(() => {
  win = fakeBrowser();
  resetDedupeMemory();
});
afterEach(() => vi.unstubAllGlobals());

describe("claimOnce", () => {
  it("is true the first time only", () => {
    expect(claimOnce("game_started:m1:p1")).toBe(true);
    expect(claimOnce("game_started:m1:p1")).toBe(false);
    expect(claimOnce("game_started:m1:p2")).toBe(true);
  });

  it("survives a reload through localStorage", () => {
    claimOnce("game_done:m1:p1", { level: 3 }, 1_000);
    resetDedupeMemory();
    expect(claimOnce("game_done:m1:p1", undefined, 2_000)).toBe(false);
    expect(sentRecord("game_done:m1:p1", 2_000)).toEqual({ at: 1_000, data: { level: 3 } });
  });

  it("forgets keys after 48 hours", () => {
    claimOnce("k", undefined, 0);
    resetDedupeMemory();
    expect(claimOnce("k", undefined, 49 * HOUR)).toBe(true);
  });

  it("keeps at most 200 keys, newest first", () => {
    for (let i = 0; i < 230; i++) claimOnce(`key-${i}`, undefined, 1_000 + i);
    const stored = JSON.parse(win.localStorage.getItem("luddo-analytics-sent-v1")!);
    expect(Object.keys(stored)).toHaveLength(200);
    expect(stored["key-229"]).toBeDefined();
    expect(stored["key-0"]).toBeUndefined();
  });

  it("still works in memory when storage throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new Error("private");
        },
        setItem() {
          throw new Error("private");
        },
      },
    });
    expect(claimOnce("private")).toBe(true);
    expect(claimOnce("private")).toBe(false);
  });
});
