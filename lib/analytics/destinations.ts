import posthog from "posthog-js";
import type { CleanParams } from "./sanitize";
import { currentPageLocation, redactReferrer } from "./redact";

/**
 * Where events go (docs/analytics.md, "Architecture").
 *
 * - Google Tag Manager: the website only. The inline script in app/layout.tsx
 *   sets `window.__luddoTagsOn` when Tag Manager may load (a production host,
 *   no under-13 flag); without it nothing is pushed. The container's GA4 tag
 *   reads the `luddo` object, so it is cleared before each event: GTM's data
 *   layer otherwise keeps a previous event's parameters.
 * - PostHog: the website and the iOS and Android apps, wherever
 *   instrumentation-client.ts initialised it and capture isn't opted out.
 */

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  __luddoTagsOn?: boolean;
  __luddoDebug?: boolean;
};

function analyticsWindow(): AnalyticsWindow | null {
  return typeof window === "undefined" ? null : (window as AnalyticsWindow);
}

/**
 * The iOS and Android app build (CAPACITOR_BUILD, next.config.ts) sets
 * LUDDO_APP_BUILD, so every Tag Manager branch below compiles out of it:
 * the app carries no Google Analytics or Tag Manager code, only PostHog.
 */
export function tagsOn(): boolean {
  if (process.env.LUDDO_APP_BUILD) return false;
  return analyticsWindow()?.__luddoTagsOn === true;
}

/** Hits from a preview or local build are marked debug, so GA's developer filter drops them. */
export function debugHits(): boolean {
  return analyticsWindow()?.__luddoDebug === true;
}

function dataLayer(): unknown[] {
  const w = analyticsWindow();
  if (!w) return [];
  w.dataLayer = w.dataLayer || [];
  return w.dataLayer;
}

/** A gtag() command. It must push the real `arguments` object, as gtag.js expects. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function gtag(..._args: unknown[]) {
  // eslint-disable-next-line prefer-rest-params
  dataLayer().push(arguments);
}

let readyPushed = false;

/** Starts the container's Google tag (it fires on `luddo_ready`, which only this code pushes). */
export function markTagsReady() {
  if (process.env.LUDDO_APP_BUILD) return;
  if (readyPushed || !tagsOn()) return;
  readyPushed = true;
  dataLayer().push({ event: "luddo_ready" });
}

let pageSet = false;

export function sendToTagManager(name: string, params: CleanParams) {
  if (process.env.LUDDO_APP_BUILD) return;
  if (!tagsOn()) return;
  // An event from a component that mounts before AnalyticsRoot's effects
  // still follows the Google tag and a cleaned page, never the raw URL.
  markTagsReady();
  if (!pageSet)
    setTagManagerPage({
      page_location: currentPageLocation(),
      page_referrer: redactReferrer(document.referrer, window.location.origin),
      page_title: document.title,
    });
  const layer = dataLayer();
  layer.push({ luddo: null });
  layer.push({ event: name, luddo: params });
}

/**
 * The cleaned page for every later hit, the Google tag's automatic events
 * included, plus the top-level keys the container's event tag reads.
 */
export function setTagManagerPage(page: { page_location: string; page_referrer: string; page_title: string }) {
  if (process.env.LUDDO_APP_BUILD) return;
  if (!tagsOn()) return;
  pageSet = true;
  dataLayer().push({ ...page });
  gtag("set", page);
}

/** User properties live under `luddo_user`, which persists in GTM's data model. */
export function setTagManagerUser(properties: CleanParams) {
  if (process.env.LUDDO_APP_BUILD) return;
  if (!tagsOn()) return;
  dataLayer().push({ luddo_user: properties });
}

function postHogReady(): boolean {
  try {
    return !!posthog.__loaded && !posthog.has_opted_out_capturing();
  } catch {
    return false;
  }
}

export function sendToPostHog(name: string, params: CleanParams) {
  if (!postHogReady()) return;
  posthog.capture(name, params);
}

/** Super properties: every later PostHog event carries them. */
export function setPostHogUser(properties: CleanParams) {
  if (!postHogReady()) return;
  posthog.register(properties);
}

/** Test helper. */
export function resetDestinationsForTests() {
  readyPushed = false;
  pageSet = false;
}
