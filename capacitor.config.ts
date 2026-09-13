import type { CapacitorConfig } from "@capacitor/cli";

/**
 * PREP ONLY — not built or shipped this phase. Per docs/PRD.md Section 1.3/6.1:
 * MVP ships as responsive web only. No native platform (`npx cap add ios|android`)
 * has been added, and none should be until that scope decision changes.
 */
const config: CapacitorConfig = {
  appId: "com.ludorivals.app",
  appName: "Ludo Rivals",
  webDir: "out",
};

export default config;
