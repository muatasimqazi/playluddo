import posthog from "posthog-js";

/**
 * No analytics in a child's session (docs/COMPETITIVE_ROADMAP.md F0.4, F5.6:
 * the app isn't designed for under-13s; docs/analytics.md, "Under-13 off
 * switch").
 *
 * Two device flags turn analytics off, and both are read again on every page
 * load, before Google Tag Manager is allowed to load (the inline script in
 * app/layout.tsx) and before PostHog opts back in (instrumentation-client.ts):
 *
 * - `luddo-under-13-until`: this device answered under 13. Written by
 *   lib/community.ts (blockDeviceUntil), which also gates new age answers.
 * - `luddo-analytics-off-until`: an account the server marks as under 13 was
 *   used here. It only switches analytics off; it never blocks age answers.
 *
 * Both hold the day the block lifts (YYYY-MM-DD, local time), so an account
 * that turns 13 is measured again. PostHog's opt-out state on this device
 * only ever means "a child was here".
 */

export const DEVICE_UNDER_13_KEY = "luddo-under-13-until";
export const ACCOUNT_UNDER_13_KEY = "luddo-analytics-off-until";

let offThisPage = false;

function localDay(date: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** True while either under-13 flag stands on this device, or after a stop on this page. */
export function childAnalyticsOff(now = new Date()): boolean {
  if (offThisPage) return true;
  try {
    const today = localDay(now);
    const device = window.localStorage.getItem(DEVICE_UNDER_13_KEY);
    const account = window.localStorage.getItem(ACCOUNT_UNDER_13_KEY);
    return (!!device && DAY.test(device) && device > today) || (!!account && DAY.test(account) && account > today);
  } catch {
    return false;
  }
}

/**
 * Stops every analytics destination at once: Google Analytics (including its
 * automatic events, through `ga-disable-<id>`), Tag Manager pushes from the
 * analytics module, and PostHog capture and recording. `eligibleFrom` is the
 * day the server says the account turns 13; without it the flag holds for a
 * year and is renewed whenever the server says so again.
 */
export function stopAnalyticsForChild(eligibleFrom?: string | null) {
  offThisPage = true;
  if (typeof window === "undefined") return;
  // Google Analytics exists on the website only (see destinations.ts).
  if (!process.env.LUDDO_APP_BUILD) {
    try {
      const w = window as unknown as Record<string, unknown>;
      const gaId = w.__luddoGaId;
      if (typeof gaId === "string" && gaId) w[`ga-disable-${gaId}`] = true;
      w.__luddoTagsOn = false;
    } catch {
      /* Nothing loaded: nothing to stop. */
    }
  }
  try {
    const previous = window.localStorage.getItem(ACCOUNT_UNDER_13_KEY);
    const standing = !!previous && DAY.test(previous) && previous > localDay(new Date());
    if (eligibleFrom && DAY.test(eligibleFrom)) {
      // The server's date: only ever pushes the flag later.
      if (!standing || previous! < eligibleFrom) window.localStorage.setItem(ACCOUNT_UNDER_13_KEY, eligibleFrom);
    } else if (!standing) {
      // No date given and no flag standing: a year, renewed whenever the server says so again.
      const next = new Date();
      next.setFullYear(next.getFullYear() + 1);
      window.localStorage.setItem(ACCOUNT_UNDER_13_KEY, localDay(next));
    }
  } catch {
    // Private mode: this page is still off; the server will say so again.
  }
  if (!posthog.__loaded) return;
  posthog.stopSessionRecording();
  posthog.opt_out_capturing();
}

/** Test helper. */
export function resetChildSwitchForTests() {
  offThisPage = false;
}
