import { useSyncExternalStore } from "react";

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

/** Short tap feedback where the platform supports it (Android; iOS Safari ignores it). */
export function hapticTap(pattern: number | number[] = 12) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some browsers throw without a prior user gesture; feedback is optional.
    }
  }
}
