/**
 * URL redaction for analytics (docs/analytics.md, "URL redaction").
 *
 * A room link is the invitation itself, and other links carry team invite
 * codes, cast tokens and OAuth codes. So URLs are cleaned by allow-list: the
 * origin and path stay, plus only the query keys below. Everything else, and
 * the fragment, is dropped. GA4's own query-key redaction is a backstop.
 */

const ALLOWED_QUERY_KEYS = [
  // The entrance's step (quick, friends, practice, together): no access granted.
  "play",
  // Acquisition: Product Hunt appends ?ref=producthunt.
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
];

/** origin + path + allowed query keys; "" for anything that isn't a URL. */
export function redactUrl(href: string, base?: string): string {
  let url: URL;
  try {
    url = base ? new URL(href, base) : new URL(href);
  } catch {
    return "";
  }
  const kept: string[] = [];
  for (const key of ALLOWED_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null) kept.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  const origin = url.protocol === "http:" || url.protocol === "https:" ? url.origin : `${url.protocol}//${url.host}`;
  return `${origin}${url.pathname}${kept.length ? `?${kept.join("&")}` : ""}`;
}

/**
 * A referrer from this site is cleaned like any URL; another site's referrer
 * keeps only its origin, since its path and query belong to someone else.
 */
export function redactReferrer(referrer: string, currentOrigin: string): string {
  if (!referrer) return "";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "";
  }
  if (url.origin === currentOrigin) return redactUrl(referrer);
  return url.protocol === "http:" || url.protocol === "https:" ? `${url.origin}/` : "";
}

/** The current page, cleaned, for analytics. Empty on the server. */
export function currentPageLocation(): string {
  if (typeof window === "undefined") return "";
  return redactUrl(window.location.href);
}
