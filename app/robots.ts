import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

// Required for the static-export Capacitor build (next.config.ts,
// output: "export") — this route has no per-request data, so it's
// always safe to render once at build time.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BRAND.url}/sitemap.xml`,
  };
}
