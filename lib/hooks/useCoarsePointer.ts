import { useSyncExternalStore } from "react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { isNativeApp } from "../native";

const QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * True on touch-first devices (phones, tablets) — the ones that need
 * finger-sized targets and a board that doesn't drift under a tap.
 * Keyed on the input, not screen width, so a narrow desktop window keeps
 * its mouse behavior and a landscape tablet still gets the touch one.
 */
export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Short tap feedback. In the iOS app it goes through the native Taptic
 * Engine (Capacitor Haptics) — iOS Safari/WKWebView ignore navigator.vibrate.
 * On the web it's navigator.vibrate where supported (Android).
 */
export function hapticTap(pattern: number | number[] = 12) {
  if (isNativeApp()) {
    const strong = (Array.isArray(pattern) ? Math.max(...pattern) : pattern) >= 16;
    void Haptics.impact({ style: strong ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
    return;
  }
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some browsers throw without a prior user gesture; feedback is optional.
    }
  }
}
