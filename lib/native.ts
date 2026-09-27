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
