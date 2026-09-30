"use client";

// Forwards a legacy `/tournaments/<id>` URL to `/tournaments/view?id=<id>`.
// Reads the id at runtime (not at build), so the single prerendered static
// page works for any real id under the Capacitor export.
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export function LegacyTournamentRedirect() {
  const params = useParams();
  const router = useRouter();
  useEffect(() => {
    const raw = params?.id;
    const id = Array.isArray(raw) ? raw[0] : raw;
    if (id && id !== "_") {
      router.replace(`/tournaments/view?id=${encodeURIComponent(id)}`);
    } else {
      router.replace("/tournaments");
    }
  }, [params, router]);
  return null;
}
