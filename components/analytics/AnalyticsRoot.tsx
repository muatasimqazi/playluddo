"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useGamePreference } from "@/lib/preferences-react";
import {
  analyticsEnabled,
  holdAnalytics,
  releaseAnalytics,
  setTagManagerPage,
  setUserProperties,
  stopAnalyticsForChild,
  track,
} from "@/lib/analytics";
import { currentPageLocation, redactReferrer } from "@/lib/analytics/redact";
import { handleAuthUser } from "@/lib/analytics/auth";
import { getAgeEligibility, type AgeEligibility } from "@/lib/supabase/rpc";

/**
 * Page views, user properties and sign-in events, mounted once in the root
 * layout (docs/analytics.md, "Architecture").
 *
 * Page views are sent by the app, not by GA's history tracking, so every URL
 * is cleaned first (lib/analytics/redact.ts): once on load and once per
 * pathname change. A change of query string alone (the entrance's ?play=
 * steps) is not a new page. Nothing here renders.
 *
 * Events wait until the auth state is known, and for a signed-in account
 * until its age is: an account the server marks under 13 on a device that
 * doesn't know it yet sends nothing at all, not even this page view.
 */

/** How long to wait for the age check before dropping what waited. */
const AGE_CHECK_TIMEOUT_MS = 8000;

const GRAPHICS = ["low", "medium", "high", "ultra"] as const;

function graphicsQuality() {
  try {
    const saved = JSON.parse(window.localStorage.getItem("luddo-simulator-v1") || "{}") as { quality?: string };
    return GRAPHICS.find((q) => q === saved.quality);
  } catch {
    return undefined;
  }
}

let lastPageView: { path: string; at: number } | null = null;

export function AnalyticsRoot() {
  const pathname = usePathname();
  const { locale } = useI18n();
  const [colorBlind] = useGamePreference("colorBlind");
  const [reduceMotion] = useGamePreference("reduceMotion");
  const previousLocation = useRef<string | null>(null);

  // First of all: hold events until the auth state, and a signed-in
  // account's age, are known. Releasing also starts the container's Google
  // tag (luddo_ready). Then sign-in events (lib/analytics/auth.ts).
  useEffect(() => {
    holdAnalytics();
    const client = createClient();
    const ages = new Map<string, Promise<AgeEligibility>>();
    const ageOf = (id: string) => {
      let age = ages.get(id);
      if (!age) {
        age = getAgeEligibility(client);
        ages.set(id, age);
      }
      return age;
    };
    const verdicts = new Map<string, "checking" | "ok" | "child">();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      void handleAuthUser(user, Date.now(), () => ageOf(user!.id));
      if (!user || user.is_anonymous) {
        releaseAnalytics(true);
        return;
      }
      const verdict = verdicts.get(user.id);
      if (verdict === "ok") releaseAnalytics(true);
      if (verdict) return;
      verdicts.set(user.id, "checking");
      holdAnalytics();
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), AGE_CHECK_TIMEOUT_MS));
      Promise.race([ageOf(user.id), timeout])
        .then((age) => {
          if (age.declared && !age.online) {
            verdicts.set(user.id, "child");
            stopAnalyticsForChild(age.eligibleFrom);
            releaseAnalytics(false);
          } else {
            verdicts.set(user.id, "ok");
            releaseAnalytics(true);
          }
        })
        .catch(() => {
          // Unknown: drop what waited, then carry on (a later answer can still stop it all).
          verdicts.set(user.id, "ok");
          releaseAnalytics(false);
        });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Before the first page view, so it carries them.
  useEffect(() => {
    setUserProperties({
      app_locale: locale,
      colorblind_mode: colorBlind,
      reduced_motion: reduceMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
      graphics_quality: graphicsQuality(),
    });
  }, [locale, colorBlind, reduceMotion]);

  useEffect(() => {
    if (!analyticsEnabled()) return;
    // Strict Mode runs effects twice in development; one page is one view.
    if (lastPageView && lastPageView.path === pathname && Date.now() - lastPageView.at < 1000) return;
    lastPageView = { path: pathname, at: Date.now() };
    const location = currentPageLocation();
    const page = {
      page_location: location,
      page_referrer: previousLocation.current ?? redactReferrer(document.referrer, window.location.origin),
      page_title: document.title,
    };
    previousLocation.current = location;
    setTagManagerPage(page);
    track("page_view", page);
  }, [pathname]);


  return null;
}
