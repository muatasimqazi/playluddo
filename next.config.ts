import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pins the workspace root to this repo — without it, Turbopack walks up
  // and picks up an unrelated package-lock.json in the user's home directory.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Only the Capacitor build (npm run build:capacitor) needs a fully
  // static bundle to embed in the native shell (capacitor.config.ts,
  // webDir: "out"). The Vercel web deploy keeps its normal dynamic build
  // so it can still grow a real server route later.
  output: process.env.CAPACITOR_BUILD ? "export" : undefined,
};

export default nextConfig;
