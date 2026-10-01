"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useGamePreference } from "@/lib/preferences-react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * Whether to still the table (F5.5): the device asks for reduced motion, or
 * the player turned on "Reduce motion" in the app. Live — flipping either one
 * mid-game applies at once.
 */
export function useReducedMotion(): boolean {
  const system = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  const [preference] = useGamePreference("reduceMotion");
  return system || preference;
}

/**
 * Mirrors the in-app "Reduce motion" choice onto <html> as `reduce-motion`,
 * so the stylesheet can stop CSS animations for it the same way it does for
 * the device setting. Mount once, near the root.
 */
export function useReducedMotionClass() {
  const [preference] = useGamePreference("reduceMotion");
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", preference);
  }, [preference]);
}
