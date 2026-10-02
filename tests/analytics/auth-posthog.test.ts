import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventsPushed, fakeBrowser, pushes, type FakeWindow } from "./fakeBrowser";
import { redactPostHogEvent } from "../../lib/analytics/posthogRedact";

vi.mock("posthog-js", async () => {
  const { posthogMock } = await import("./fakeBrowser");
  return { default: posthogMock() };
});

type Auth = typeof import("../../lib/analytics/auth");

const NOW = Date.parse("2026-10-01T12:00:00Z");
const MINUTE = 60 * 1000;
let win: FakeWindow;
let auth: Auth;

function user(id: string, options: { anonymous?: boolean; createdMinutesAgo?: number } = {}): User {
  return {
    id,
    is_anonymous: !!options.anonymous,
    created_at: new Date(NOW - (options.createdMinutesAgo ?? 60 * 24 * 30) * MINUTE).toISOString(),
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
  } as User;
}

beforeEach(async () => {
  win = fakeBrowser();
  vi.resetModules();
  auth = await import("../../lib/analytics/auth");
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const signIns = () => eventsPushed(win).filter((e) => e.event === "sign_up" || e.event === "login");

describe("sign_up and login", () => {
  it("counts a guest who links an account as a sign-up from a guest", () => {
    const guest = user("u1", { anonymous: true });
    auth.noteSignInStarted("google", guest);
    auth.handleAuthUser(user("u1", { createdMinutesAgo: 90 }), NOW);
    expect(signIns()).toEqual([{ event: "sign_up", luddo: { method: "google", from_guest: true } }]);
  });

  it("counts a brand-new account as a sign-up", () => {
    auth.noteSignInStarted("email_code", user("guest", { anonymous: true }));
    auth.handleAuthUser(user("u2", { createdMinutesAgo: 1 }), NOW);
    expect(signIns()).toEqual([{ event: "sign_up", luddo: { method: "email_code", from_guest: false } }]);
  });

  it("counts an existing account as a login", () => {
    auth.noteSignInStarted("apple", null);
    auth.handleAuthUser(user("u3"), NOW);
    expect(signIns()).toEqual([{ event: "login", luddo: { method: "apple" } }]);
  });

  it("sends one event per sign-in, and none for a restored session or a refresh", () => {
    auth.handleAuthUser(user("u4"), NOW);
    auth.noteSignInStarted("google", null);
    auth.handleAuthUser(user("u4"), NOW);
    auth.handleAuthUser(user("u4"), NOW);
    expect(signIns()).toHaveLength(1);
  });

  it("waits for the account's age, and never reports an under-13 sign-in", async () => {
    auth.noteSignInStarted("google", null);
    await auth.handleAuthUser(user("child"), NOW, async () => ({ declared: true, online: false, eligibleFrom: "2030-05-01" }));
    expect(signIns()).toHaveLength(0);
    expect(win.localStorage.getItem("luddo-analytics-off-until")).toBe("2030-05-01");

    auth.noteSignInStarted("google", null);
    await auth.handleAuthUser(user("teen"), NOW, async () => ({ declared: true, online: true, eligibleFrom: null }));
    expect(signIns()).toHaveLength(0); // analytics stay off on this device
  });

  it("reports a sign-in once the account is known to be 13+ or undeclared", async () => {
    auth.noteSignInStarted("apple", null);
    await auth.handleAuthUser(user("adult"), NOW, async () => ({ declared: false, online: false, eligibleFrom: null }));
    expect(signIns()).toEqual([{ event: "login", luddo: { method: "apple" } }]);
  });

  it("reports nothing when the age check fails", async () => {
    auth.noteSignInStarted("apple", null);
    await auth.handleAuthUser(user("offline"), NOW, async () => {
      throw new Error("network");
    });
    expect(signIns()).toHaveLength(0);
  });

  it("forgets a sign-in that never finished", () => {
    auth.noteSignInStarted("phone_code", null);
    vi.spyOn(Date, "now").mockReturnValue(NOW + 31 * MINUTE);
    auth.handleAuthUser(user("u5"), NOW + 31 * MINUTE);
    expect(signIns()).toHaveLength(0);
  });

  it("sets the player type on every change", () => {
    auth.handleAuthUser(null, NOW);
    auth.handleAuthUser(user("g", { anonymous: true }), NOW);
    auth.handleAuthUser(user("s"), NOW);
    const types = pushes(win)
      .filter((p) => "luddo_user" in p)
      .map((p) => (p.luddo_user as { player_type: string }).player_type);
    expect(types).toEqual(["visitor", "guest", "signed_in"]);
  });
});

describe("PostHog URL redaction", () => {
  it("cleans every URL an event carries", () => {
    const event = redactPostHogEvent({
      uuid: "1",
      event: "$pageview",
      properties: {
        $current_url: "https://www.luddohouse.com/room?id=secret",
        $referrer: "https://www.luddohouse.com/?team=TEAM42",
        $set: { $current_url: "https://www.luddohouse.com/watch?room=secret&cast=t" },
        $snapshot_data: [{ type: 4, data: { href: "https://www.luddohouse.com/screen?id=secret" } }],
      },
      $set_once: { $initial_current_url: "https://www.luddohouse.com/?code=oauth&utm_source=x" },
    } as never)!;
    const text = JSON.stringify(event);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("TEAM42");
    expect(text).not.toContain("oauth");
    expect(event.properties.$current_url).toBe("https://www.luddohouse.com/room");
    expect(event.$set_once?.$initial_current_url).toBe("https://www.luddohouse.com/?utm_source=x");
  });

  it("cleans PostHog's session-entry copies and clicked links", () => {
    const event = redactPostHogEvent({
      uuid: "3",
      event: "$autocapture",
      properties: {
        $session_entry_url: "https://www.luddohouse.com/screen?id=secret&cast=token",
        $session_entry_referrer: "https://www.luddohouse.com/?team=TEAM42",
        $elements_chain: 'a.sim-primary:attr__href="/room?id=secret-room"href="/room?id=secret-room"nth-child="1";div',
        $elements: [{ tag_name: "a", attr__href: "/watch?room=secret", href: "/watch?room=secret" }],
        $pathname: "/room",
        $replay_override_url_trigger_status: "trigger_pending",
      },
    } as never)!;
    expect(JSON.stringify(event)).not.toMatch(/secret|token|TEAM42/);
    expect(event.properties.$session_entry_url).toBe("https://www.luddohouse.com/screen");
    expect(event.properties.$elements_chain).toContain('attr__href="https://www.luddohouse.com/room"');
    expect(event.properties.$replay_override_url_trigger_status).toBe("trigger_pending");
  });

  it("cleans app URLs too", () => {
    const event = redactPostHogEvent({
      uuid: "4",
      event: "$pageview",
      properties: { $current_url: "capacitor://localhost/room?id=secret" },
    } as never)!;
    expect(event.properties.$current_url).toBe("capacitor://localhost/room");
  });

  it("leaves $direct and events without URLs alone", () => {
    const event = redactPostHogEvent({ uuid: "2", event: "x", properties: { $referrer: "$direct", a: 1 } } as never)!;
    expect(event.properties).toEqual({ $referrer: "$direct", a: 1 });
    expect(redactPostHogEvent(null)).toBeNull();
  });
});
