import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

// Required for the static-export Capacitor build (next.config.ts,
// output: "export") — this route has no per-request data, so it's
// always safe to render once at build time.
export const dynamic = "force-static";

// Only the public, indexable routes — /room/* is a private, dynamically
// created table and shouldn't be crawled.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: BRAND.url, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BRAND.url}/practice`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BRAND.url}/table-together`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
