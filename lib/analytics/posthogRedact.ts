import type { CaptureResult } from "posthog-js";
import { redactUrl } from "./redact";

/**
 * PostHog `before_send` (instrumentation-client.ts): cleans every URL an
 * event carries with the same allow-list as Google Analytics: page and
 * referrer properties (and their $initial_ and $session_entry_ copies), the
 * person properties PostHog sets once, clicked links' addresses in
 * autocapture, and the page address inside session replay "meta" snapshots
 * (rrweb event type 4).
 */

// Every property PostHog fills with an address: $current_url, $referrer, their
// $initial_ and $session_entry_ copies ($session_entry_url and so on).
const URL_PROPERTY = /(url|referrer|href)$/i;

const LOOKS_LIKE_URL = /^([a-z][a-z0-9+.-]*:|\/)/i;

function cleanUrl(value: string): string {
  if (!LOOKS_LIKE_URL.test(value)) return value;
  const base = typeof window !== "undefined" ? window.location.href : undefined;
  return redactUrl(value, base) || value.split(/[?#]/)[0];
}

function cleanProperties(properties: Record<string, unknown> | undefined) {
  if (!properties || typeof properties !== "object") return;
  for (const name of Object.keys(properties)) {
    const value = properties[name];
    if (URL_PROPERTY.test(name) && typeof value === "string" && value && value !== "$direct")
      properties[name] = cleanUrl(value);
  }
}

// Autocapture keeps a clicked link's address in $elements_chain
// (`…:attr__href="/room?id=…"href="/room?id=…"…`) and in $elements.
const CHAIN_HREF = /((?:attr__)?href=")((?:[^"\\]|\\.)*)(")/g;

function cleanElements(properties: Record<string, unknown>) {
  const chain = properties.$elements_chain;
  if (typeof chain === "string")
    properties.$elements_chain = chain.replace(CHAIN_HREF, (_, open: string, href: string, close: string) => open + cleanUrl(href) + close);
  const elements = properties.$elements;
  if (Array.isArray(elements))
    for (const element of elements) cleanProperties(element as Record<string, unknown>);
}

export function redactPostHogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  try {
    cleanProperties(event.properties);
    if (event.properties) cleanElements(event.properties);
    cleanProperties(event.$set);
    cleanProperties(event.$set_once);
    cleanProperties(event.properties?.$set as Record<string, unknown> | undefined);
    cleanProperties(event.properties?.$set_once as Record<string, unknown> | undefined);
    const snapshots = event.properties?.$snapshot_data;
    if (Array.isArray(snapshots)) {
      for (const snapshot of snapshots) {
        const data = (snapshot as { type?: number; data?: { href?: unknown } } | null)?.data;
        if ((snapshot as { type?: number }).type === 4 && data && typeof data.href === "string")
          data.href = cleanUrl(data.href);
      }
    }
  } catch {
    // Never drop an event over cleaning it.
  }
  return event;
}
