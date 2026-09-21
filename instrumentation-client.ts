import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    // App Router navigations are client-side (no full page load), so we
    // capture pageviews ourselves: once here for the initial load, then
    // again from onRouterTransitionStart on every later navigation.
    capture_pageview: false,
    capture_pageleave: true,
  });
  posthog.capture("$pageview");
}

export function onRouterTransitionStart(url: string) {
  posthog.capture("$pageview", { $current_url: url });
}
