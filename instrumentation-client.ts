import posthog from "posthog-js";
import { deviceAgeBlocked } from "./lib/community";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    // App Router navigations are client-side (no full page load), so we
    // capture pageviews ourselves: once here for the initial load, then
    // again from onRouterTransitionStart on every later navigation.
    capture_pageview: false,
    capture_pageleave: true,
    // Session replay records layout, taps and scrolls, never words: every
    // piece of on-screen text (names, chat, codes) and every input is masked,
    // as the privacy policy says. The 3D table's canvas and video tiles
    // aren't recorded (recordCanvas stays off). The PostHog project's own
    // replay masking setting must say the same, since it overrides these.
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
    },
  });
  // A device where someone answered under 13 sends nothing (F0.4); it's the
  // only opt-out the app has, so it lifts when the device flag does.
  if (deviceAgeBlocked()) posthog.opt_out_capturing();
  else if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
  posthog.capture("$pageview");
}

export function onRouterTransitionStart(url: string) {
  posthog.capture("$pageview", { $current_url: url });
}
