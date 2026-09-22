import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

// Required for the static-export Capacitor build (next.config.ts,
// output: "export") — this route has no per-request data, so it's
// always safe to render once at build time.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/",
    display: "standalone",
    background_color: "#f8f9fa",
    theme_color: "#f8f9fa",
    icons: [{ src: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
  };
}
