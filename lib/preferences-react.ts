"use client";

/**
 * React binding for the reactive game-preference store (lib/preferences.ts).
 *
 * Reading through useSyncExternalStore means a component re-renders the moment
 * a preference changes anywhere — including when sign-in reconciliation pulls
 * the account's saved copy in while the screen is already open. The server
 * snapshot is the plain default, so it never reads storage during SSR.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
  defaultGameSnapshot,
  gamePreferences,
  type GamePreferenceKey,
  type UserPreferences,
} from "./preferences";

export function useGamePreference<K extends GamePreferenceKey>(
  key: K,
): [UserPreferences[K], (value: UserPreferences[K]) => void] {
  const value = useSyncExternalStore(
    gamePreferences.subscribe,
    () => gamePreferences.get(key),
    () => defaultGameSnapshot(key),
  );
  const setValue = useCallback((next: UserPreferences[K]) => gamePreferences.set(key, next), [key]);
  return [value, setValue];
}
