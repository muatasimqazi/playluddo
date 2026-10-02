import posthog from "posthog-js";
import { childAnalyticsOff } from "./lib/analytics/children";
import { redactPostHogEvent } from "./lib/analytics/posthogRedact";
import { redactUrl } from "./lib/analytics/redact";

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
    // A room link is the invitation to the table, and other links carry
    // team invite codes, cast tokens and OAuth codes: every URL PostHog
    // records is cleaned first (docs/analytics.md, "URL redaction").
    before_send: redactPostHogEvent,
  });
  // A device where someone answered under 13, or where an account the
  // server marks under 13 was used, sends nothing (F0.4). It's the only
  // opt-out the app has, so it lifts when both flags have.
  if (childAnalyticsOff()) posthog.opt_out_capturing();
  else if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
  posthog.capture("$pageview");
}

export function onRouterTransitionStart(url: string) {
  posthog.capture("$pageview", { $current_url: redactUrl(url, window.location.href) });
}
