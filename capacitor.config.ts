import type { CapacitorConfig } from "@capacitor/cli";
import { BRAND } from "./lib/brand";

/**
 * Native iOS/Android platforms (`ios/`, `android/`) were added via
 * `npx cap add ios|android` — see docs/PRD.md Section 1.3/6.1 for why
 * Capacitor was staged ahead of this. `webDir: "out"` is the static export
 * produced by `npm run build:capacitor` (next.config.ts). Sync changes into
 * both native projects with `npm run cap:sync`.
 */
const config: CapacitorConfig = {
  appId: "com.luddohouse.app",
  appName: BRAND.name,
  webDir: "out",
  // The app's own dark green, so there's no white flash behind the web
  // view while it loads or when it bounces at an edge.
  backgroundColor: "#1e2720",
  ios: {
    // The page handles safe areas itself (viewport-fit=cover +
    // env(safe-area-inset-*) in simulator.css).
    contentInset: "never",
    // Game screens manage their own scrolling; the lobby/leaderboard pages
    // scroll as documents, which still works with this off.
    scrollEnabled: true,
    // WKWebView link previews on long-press get in the way of dragging the
    // board and tapping pawns.
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: {
      // NativeShell hides it as soon as the first screen renders; this is
      // only the fallback if that never happens.
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: "#1e2720",
      showSpinner: false,
    },
    // Push notifications (lib/push). A table invitation that arrives while
    // the app is open still shows as a banner; turn alerts are only sent
    // while the app is in the background.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    // Native Sign in with Apple and Google (lib/nativeAuth.ts). Only the
    // providers the app uses are bundled — `false` keeps the Facebook SDK
    // out of the app entirely. Rerun `npx cap sync` after changing this.
    SocialLogin: {
      providers: { apple: true, google: true, facebook: false, twitter: false },
      logLevel: 1,
    },
  },
};

export default config;
