import { Capacitor } from "@capacitor/core";
import { BRAND } from "./brand";

/** True inside the iOS/Android app shell (Capacitor), false on the web. */
export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

/**
 * An absolute link to `path` that works for someone else. On the web that's
 * this page's own origin; inside the app the page is served from
 * capacitor://localhost, which means nothing to a friend or to an auth
 * redirect, so links point at the public site instead.
 */
export function webUrl(path = "/") {
  const base = isNativeApp() ? BRAND.url : window.location.origin;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * This page as a {@link webUrl}: where a sign-in that leaves the page (Google,
 * Apple, an emailed link) should bring the player back, so a shared link —
 * a team invite, a table — still goes where it was meant to. What a sign-in
 * itself left in the address is dropped.
 */
export function webUrlHere() {
  const url = new URL(window.location.href);
  for (const key of ["code", "error", "error_code", "error_description"]) url.searchParams.delete(key);
  return webUrl(`${url.pathname}${url.search}`);
}
