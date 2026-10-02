import type { ErrorArea, EventMap, EventName, UserProperties } from "./events";
import { sanitize } from "./sanitize";
import { claimOnce, type SentRecord } from "./dedupe";
import { childAnalyticsOff } from "./children";
import {
  debugHits,
  markTagsReady,
  sendToPostHog,
  sendToTagManager,
  setPostHogUser,
  setTagManagerUser,
} from "./destinations";

/**
 * The one way the app sends an analytics event (docs/analytics.md).
 * Components call `track()`; nothing else touches gtag, the data layer or
 * PostHog's capture for domain events.
 *
 * It does nothing on the server, after an under-13 answer or account on this
 * device, or when no destination is available (the app has no Tag Manager;
 * a blocked script has no effect beyond its own pushes).
 */

export interface TrackOptions {
  /** Send at most once per device for this key (see dedupe.ts). */
  once?: string;
  /** Facts stored with the once-key, e.g. a game's start time. */
  onceData?: SentRecord["data"];
}

export function analyticsEnabled(): boolean {
  return typeof window !== "undefined" && !childAnalyticsOff();
}

/**
 * The account hold (docs/analytics.md, "Under-13 off switch"). While a
 * signed-in account's age is being checked, events wait here; they go out
 * once the account is known not to be under 13, and are dropped otherwise.
 * components/analytics/AnalyticsRoot.tsx holds and releases it.
 */
let held: (() => void)[] | null = null;
const MAX_HELD = 50;

export function holdAnalytics() {
  if (!held) held = [];
}

export function releaseAnalytics(send: boolean) {
  const queue = held;
  held = null;
  if (!send || !analyticsEnabled()) return;
  markTagsReady();
  for (const run of queue ?? []) run();
}

export function track<E extends EventName>(name: E, params: EventMap[E], options?: TrackOptions): boolean {
  if (!analyticsEnabled()) return false;
  if (options?.once && !claimOnce(options.once, options.onceData)) return false;
  const clean = sanitize(params);
  const send = () => {
    if (!analyticsEnabled()) return;
    try {
      sendToTagManager(name, debugHits() ? { ...clean, debug_mode: true } : clean);
      // PostHog records its own $pageview; a second page_view would double it.
      if (name !== "page_view") sendToPostHog(name, clean);
    } catch {
      // Analytics must never break the game.
    }
  };
  if (held) {
    if (held.length < MAX_HELD) held.push(send);
  } else send();
  return true;
}

const userProperties: UserProperties = {};

export function setUserProperties(update: UserProperties) {
  if (!analyticsEnabled()) return;
  let changed = false;
  for (const key of Object.keys(update) as (keyof UserProperties)[]) {
    const value = update[key];
    if (value === undefined || userProperties[key] === value) continue;
    (userProperties as Record<string, unknown>)[key] = value;
    changed = true;
  }
  if (!changed) return;
  const clean = sanitize(userProperties);
  try {
    setTagManagerUser(clean);
    setPostHogUser(clean);
  } catch {
    /* Never break the page for analytics. */
  }
}

export function levelBucket(level: number): UserProperties["level_bucket"] {
  if (level >= 20) return "20+";
  if (level >= 10) return "10-19";
  if (level >= 5) return "5-9";
  if (level >= 2) return "2-4";
  return "1";
}

/**
 * Error codes that may be reported. Any `AGE_*` code is excluded on purpose:
 * `AGE_RESTRICTED` means a child, and the age check is not a failure.
 */
const REPORTABLE_ERROR = /^(?!AGE_)[A-Z][A-Z0-9_]{1,60}$|^(scene_crash|webgl_unavailable|context_lost)$/;
const reportedErrors = new Set<string>();

/** An allow-listed failure code, at most once per area and code per page load. */
export function trackError(area: ErrorArea, code: string | null | undefined) {
  if (!code || !REPORTABLE_ERROR.test(code)) return;
  const key = `${area}:${code}`;
  if (reportedErrors.has(key)) return;
  reportedErrors.add(key);
  track("app_error", { area, error_code: code });
}

/** The code of an RpcError-like value, or UNKNOWN; never its message. */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "UNKNOWN";
}

export { setTagManagerPage, markTagsReady, tagsOn } from "./destinations";
export { stopAnalyticsForChild, childAnalyticsOff } from "./children";
export { claimOnce, sentRecord } from "./dedupe";
export type * from "./events";
