import { vi } from "vitest";

/**
 * A small stand-in for the browser globals lib/analytics reads (the test
 * environment is Node): window with storage, location and the data layer,
 * and document with a title and referrer.
 */

export class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

export interface FakeWindow {
  localStorage: MemoryStorage;
  sessionStorage: MemoryStorage;
  location: { href: string; origin: string; hostname: string; search: string };
  dataLayer?: unknown[];
  __luddoTagsOn?: boolean;
  __luddoDebug?: boolean;
  __luddoGaId?: string;
  [key: string]: unknown;
}

export function fakeBrowser(
  href = "https://www.luddohouse.com/",
  options: { tagsOn?: boolean; debug?: boolean; referrer?: string; title?: string } = {},
): FakeWindow {
  const url = new URL(href);
  const win: FakeWindow = {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    location: { href: url.href, origin: url.origin, hostname: url.hostname, search: url.search },
    dataLayer: [],
    __luddoTagsOn: options.tagsOn ?? true,
    __luddoDebug: options.debug ?? false,
    __luddoGaId: "G-TEST",
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("localStorage", win.localStorage);
  vi.stubGlobal("sessionStorage", win.sessionStorage);
  vi.stubGlobal("document", { title: options.title ?? "Luddo House", referrer: options.referrer ?? "" });
  return win;
}

/** The plain-object pushes (gtag() commands are `arguments` objects). */
export function pushes(win: FakeWindow): Record<string, unknown>[] {
  return (win.dataLayer ?? []).filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Object.prototype.toString.call(entry).includes("Arguments"),
  );
}

/** The events pushed, by name, with their `luddo` parameters. */
export function eventsPushed(win: FakeWindow): { event: string; luddo?: Record<string, unknown> }[] {
  return pushes(win)
    .filter((entry) => typeof entry.event === "string")
    .map((entry) => ({ event: entry.event as string, luddo: entry.luddo as Record<string, unknown> | undefined }));
}

/** posthog-js, as a mock factory for vi.mock. */
export function posthogMock() {
  const posthog = {
    __loaded: true,
    optedOut: false,
    capture: vi.fn(),
    register: vi.fn(),
    stopSessionRecording: vi.fn(),
    opt_out_capturing: vi.fn(() => {
      posthog.optedOut = true;
    }),
    has_opted_out_capturing: vi.fn(() => posthog.optedOut),
  };
  return posthog;
}
