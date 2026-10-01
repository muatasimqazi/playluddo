"use client";

/**
 * Reconciles a signed-in account's saved preferences with this device's on
 * sign-in, then keeps the account as the source of truth.
 *
 * Rules (see lib/preferences.ts): a value already on the account wins and is
 * mirrored to the device; a preference the account has never set is seeded
 * from this device's copy, so a guest's choices survive making an account.
 *
 * Renders nothing — it's mounted once, near the root, inside <I18nProvider>
 * because it drives the live locale through the i18n context. Being mounted
 * once at the root, it also mirrors "Reduce motion" onto <html> (F5.5).
 */
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { isSupportedLocale, LOCALE_STORAGE_KEY, type LocaleCode } from "@/lib/i18n/locales";
import {
  GAME_PREFERENCE_KEYS,
  gamePreferences,
  isSignedIn,
  persistPreferencesToAccount,
  preferencesFromMetadata,
  type GamePreferenceKey,
  type UserPreferences,
} from "@/lib/preferences";
import { useReducedMotionClass } from "@/lib/hooks/useReducedMotion";
import type { User } from "@supabase/supabase-js";

function explicitLocalLocale(): LocaleCode | undefined {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    return saved && isSupportedLocale(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

export function PreferencesSync() {
  // setLocale is a stable useCallback([]) from the i18n context, so the auth
  // listener below can close over it once without going stale.
  const { setLocale } = useI18n();
  useReducedMotionClass();

  useEffect(() => {
    const client = createClient();

    const reconcile = (user: User | null) => {
      if (!isSignedIn(user)) return;
      const account = preferencesFromMetadata(user!.user_metadata);
      const seed: Partial<UserPreferences> = {};

      // Language: the account's choice drives the live locale (setLocale bails
      // out if it already matches); otherwise seed the account from an explicit
      // guest choice — never from a mere browser-language default, which isn't
      // a preference the player actually set.
      if (account.locale) {
        setLocale(account.locale);
      } else {
        const local = explicitLocalLocale();
        if (local) seed.locale = local;
      }

      // The game preferences: adopt the account's copy, or seed it. A
      // generic helper keeps each key's value type intact (a plain loop widens
      // the key to a union and loses it).
      const reconcileGameKey = <K extends GamePreferenceKey>(key: K) => {
        const accountValue = account[key];
        if (accountValue !== undefined) gamePreferences.applyFromAccount(key, accountValue);
        else seed[key] = gamePreferences.get(key);
      };
      for (const key of GAME_PREFERENCE_KEYS) reconcileGameKey(key);

      void persistPreferencesToAccount(seed);
    };

    // onAuthStateChange fires INITIAL_SESSION on subscribe, covering the
    // already-signed-in case without a separate getUser() call.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      reconcile(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
    // locale/setLocale are stable enough; re-subscribing on every language
    // change would churn the auth listener for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
