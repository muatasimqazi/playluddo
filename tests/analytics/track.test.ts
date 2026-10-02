import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventsPushed, fakeBrowser, pushes, type FakeWindow } from "./fakeBrowser";

vi.mock("posthog-js", async () => {
  const { posthogMock } = await import("./fakeBrowser");
  return { default: posthogMock() };
});

type Analytics = typeof import("../../lib/analytics");
type PostHogMock = ReturnType<typeof import("./fakeBrowser").posthogMock>;

let win: FakeWindow;
let analytics: Analytics;
let posthog: PostHogMock;

async function load(href = "https://www.luddohouse.com/room?id=secret-room", options = {}) {
  win = fakeBrowser(href, options);
  vi.resetModules();
  analytics = await import("../../lib/analytics");
  posthog = (await import("posthog-js")).default as unknown as PostHogMock;
  posthog.optedOut = false;
  posthog.capture.mockClear();
  posthog.register.mockClear();
}

beforeEach(async () => {
  await load();
});
afterEach(() => vi.unstubAllGlobals());

describe("track", () => {
  it("starts the Google tag and sets a cleaned page before the first event", () => {
    analytics.track("watch_started", {});
    const layer = pushes(win);
    expect(layer[0]).toEqual({ event: "luddo_ready" });
    expect(layer[1]).toMatchObject({ page_location: "https://www.luddohouse.com/room" });
    expect(layer.slice(2)).toEqual([{ luddo: null }, { event: "watch_started", luddo: {} }]);
    expect(JSON.stringify(win.dataLayer)).not.toContain("secret-room");
  });

  it("clears the previous event's parameters before each event", () => {
    analytics.track("share", { method: "copy", content_type: "room_code" });
    analytics.track("call_joined", {});
    const layer = pushes(win);
    const last = layer.lastIndexOf(layer.find((p) => p.event === "call_joined")!);
    expect(layer[last - 1]).toEqual({ luddo: null });
  });

  it("sends cleaned parameters to Tag Manager and PostHog", () => {
    analytics.track("match_found", {
      game_type: "luddo",
      seat_count: 4,
      human_count: 2,
      bot_count: 2,
      wait_seconds: undefined,
    });
    const event = eventsPushed(win).find((e) => e.event === "match_found");
    expect(event?.luddo).toEqual({ game_type: "luddo", seat_count: 4, human_count: 2, bot_count: 2 });
    expect(posthog.capture).toHaveBeenCalledWith("match_found", {
      game_type: "luddo",
      seat_count: 4,
      human_count: 2,
      bot_count: 2,
    });
  });

  it("leaves page views to PostHog's own $pageview", () => {
    analytics.track("page_view", { page_location: "https://www.luddohouse.com/" });
    expect(eventsPushed(win).some((e) => e.event === "page_view")).toBe(true);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("marks hits from a preview or local build as debug, for GA only", async () => {
    await load("http://localhost:3917/", { debug: true });
    analytics.track("call_joined", {});
    expect(eventsPushed(win).find((e) => e.event === "call_joined")?.luddo).toEqual({ debug_mode: true });
    expect(posthog.capture).toHaveBeenCalledWith("call_joined", {});
  });

  it("pushes nothing where Tag Manager is off (the apps, other hosts)", async () => {
    await load("capacitor://localhost/", { tagsOn: false });
    expect(analytics.track("call_joined", {})).toBe(true);
    expect(win.dataLayer).toEqual([]);
    expect(posthog.capture).toHaveBeenCalledTimes(1);
  });

  it("sends a once-keyed event once per device", () => {
    expect(analytics.track("level_up", { level: 5 }, { once: "level_up:a:5" })).toBe(true);
    expect(analytics.track("level_up", { level: 5 }, { once: "level_up:a:5" })).toBe(false);
    expect(eventsPushed(win).filter((e) => e.event === "level_up")).toHaveLength(1);
  });

  it("does nothing on the server", async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    const serverAnalytics = await import("../../lib/analytics");
    expect(serverAnalytics.track("call_joined", {})).toBe(false);
  });
});

describe("the account hold", () => {
  it("keeps events until the account is known, then sends them in order", () => {
    analytics.holdAnalytics();
    analytics.track("page_view", { page_location: "https://www.luddohouse.com/" });
    analytics.track("call_joined", {});
    expect(eventsPushed(win)).toEqual([]);
    analytics.releaseAnalytics(true);
    expect(eventsPushed(win).map((e) => e.event)).toEqual(["luddo_ready", "page_view", "call_joined"]);
  });

  it("drops them for an under-13 account", () => {
    analytics.holdAnalytics();
    analytics.track("call_joined", {});
    analytics.stopAnalyticsForChild("2031-01-01");
    analytics.releaseAnalytics(false);
    analytics.track("call_joined", {});
    expect(win.dataLayer).toEqual([]);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("holds at most 50 events", () => {
    analytics.holdAnalytics();
    for (let i = 0; i < 60; i++) analytics.track("call_joined", {});
    analytics.releaseAnalytics(true);
    expect(eventsPushed(win).filter((e) => e.event === "call_joined")).toHaveLength(50);
  });
});

describe("the under-13 off switch", () => {
  it("stops every destination for the rest of the page", () => {
    analytics.stopAnalyticsForChild("2031-05-01");
    expect(win["ga-disable-G-TEST"]).toBe(true);
    expect(win.__luddoTagsOn).toBe(false);
    expect(posthog.opt_out_capturing).toHaveBeenCalled();
    expect(posthog.stopSessionRecording).toHaveBeenCalled();
    expect(analytics.track("call_joined", {})).toBe(false);
    expect(win.dataLayer).toEqual([]);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("is remembered on the device until the day the account turns 13", async () => {
    analytics.stopAnalyticsForChild("2031-05-01");
    expect(win.localStorage.getItem("luddo-analytics-off-until")).toBe("2031-05-01");
    const storage = win.localStorage;
    await load();
    win.localStorage = storage;
    vi.stubGlobal("localStorage", storage);
    expect(analytics.childAnalyticsOff(new Date(2031, 3, 30))).toBe(true);
    expect(analytics.childAnalyticsOff(new Date(2031, 4, 1))).toBe(false);
  });

  it("holds for a year when the server gives no date, and never shortens a flag", () => {
    analytics.stopAnalyticsForChild(null);
    const yearOut = win.localStorage.getItem("luddo-analytics-off-until")!;
    expect(yearOut > new Date().toISOString().slice(0, 10)).toBe(true);
    analytics.stopAnalyticsForChild("2001-01-01");
    expect(win.localStorage.getItem("luddo-analytics-off-until")).toBe(yearOut);
  });

  it("never stretches the server's date with a dateless stop", () => {
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const day = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
    analytics.stopAnalyticsForChild(day);
    analytics.stopAnalyticsForChild(null);
    analytics.stopAnalyticsForChild();
    expect(win.localStorage.getItem("luddo-analytics-off-until")).toBe(day);
  });

  it("honours the device's own under-13 answer", async () => {
    await load();
    win.localStorage.setItem("luddo-under-13-until", "2099-01-01");
    expect(analytics.track("call_joined", {})).toBe(false);
    win.localStorage.setItem("luddo-under-13-until", "2000-01-01");
    expect(analytics.track("call_joined", {})).toBe(true);
  });

  it("ignores a malformed flag", () => {
    win.localStorage.setItem("luddo-analytics-off-until", "soon");
    expect(analytics.childAnalyticsOff()).toBe(false);
  });
});

describe("errors", () => {
  it("reports allow-listed codes once per page", () => {
    analytics.trackError("join", "ROOM_FULL");
    analytics.trackError("join", "ROOM_FULL");
    analytics.trackError("three_d", "context_lost");
    expect(eventsPushed(win).filter((e) => e.event === "app_error").map((e) => e.luddo)).toEqual([
      { area: "join", error_code: "ROOM_FULL" },
      { area: "three_d", error_code: "context_lost" },
    ]);
  });

  it("never reports an age code or free text", () => {
    analytics.trackError("join", "AGE_RESTRICTED");
    analytics.trackError("join", "AGE_REQUIRED");
    analytics.trackError("join", "duplicate key value violates unique constraint");
    analytics.trackError("join", null);
    expect(eventsPushed(win).some((e) => e.event === "app_error")).toBe(false);
  });

  it("takes an error's code, never its message", () => {
    expect(analytics.errorCode({ code: "ROOM_NOT_FOUND", message: "Room abc not found" })).toBe("ROOM_NOT_FOUND");
    expect(analytics.errorCode(new Error("Room abc not found"))).toBe("UNKNOWN");
    expect(analytics.errorCode({ code: "23505" })).toBe("UNKNOWN");
  });
});

describe("user properties", () => {
  it("sends only changes, to both destinations", () => {
    analytics.setUserProperties({ player_type: "guest", app_locale: "en" });
    analytics.setUserProperties({ player_type: "guest" });
    analytics.setUserProperties({ level_bucket: analytics.levelBucket(7) });
    const users = pushes(win).filter((p) => "luddo_user" in p);
    expect(users).toHaveLength(2);
    expect(users[1].luddo_user).toEqual({ player_type: "guest", app_locale: "en", level_bucket: "5-9" });
    expect(posthog.register).toHaveBeenCalledTimes(2);
  });

  it("buckets levels", () => {
    expect([1, 2, 4, 5, 9, 10, 19, 20, 99].map(analytics.levelBucket)).toEqual([
      "1",
      "2-4",
      "2-4",
      "5-9",
      "5-9",
      "10-19",
      "10-19",
      "20+",
      "20+",
    ]);
  });
});
