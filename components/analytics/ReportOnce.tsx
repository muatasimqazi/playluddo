"use client";

import { useEffect } from "react";
import { trackError } from "@/lib/analytics";
import type { ErrorArea } from "@/lib/analytics/events";

/** Reports an allow-listed error code once when it renders (e.g. a fallback screen). */
export function ReportOnce({ area, code }: { area: ErrorArea; code: string }) {
  useEffect(() => {
    trackError(area, code);
  }, [area, code]);
  return null;
}
