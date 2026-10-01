import posthog from "posthog-js";

/**
 * No analytics in a child's session (docs/COMPETITIVE_ROADMAP.md F0.4, F5.6:
 * the app isn't designed for under-13s). Called when this device answers
 * under 13, or the server says the account is under 13: PostHog stops
 * recording and capturing at once. instrumentation-client.ts keeps it off on
 * this device while the under-13 device flag (lib/community) stands.
 *
 * The app has no other analytics opt-out, so PostHog's opt-out state on this
 * device only ever means "a child answered here".
 */
export function stopAnalyticsForChild() {
  if (!posthog.__loaded) return;
  posthog.stopSessionRecording();
  posthog.opt_out_capturing();
}
