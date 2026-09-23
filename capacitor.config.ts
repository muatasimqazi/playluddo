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
};

export default config;
