"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getMyCosmetics } from "@/lib/supabase/cosmetics";
import { FREE_COSMETICS } from "@/lib/presentation/cosmeticGates";

type Entry = { owned: boolean; requirement: string | null };

/**
 * What this account owns of the cosmetics catalog (F3.5), asked once per
 * mount: the server's own ownership check, so testers and earned unlocks
 * count. Until it answers, everything reads as owned — a saved choice draws
 * straight away instead of flashing the default — and pickers wait on
 * `ready` before showing anything as locked. With no session or no network
 * only the free defaults are owned.
 */
export function useCosmeticOwnership() {
  const [catalog, setCatalog] = useState<Map<string, Entry> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = new Map<string, Entry>();
      try {
        const client = createClient();
        const { data } = await client.auth.getSession();
        if (data.session) {
          for (const item of await getMyCosmetics(client)) {
            entries.set(item.id, { owned: item.owned, requirement: item.requirement });
          }
        }
      } catch {
        /* Offline: the free defaults below. */
      }
      if (!cancelled) setCatalog(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return useMemo(
    () => ({
      ready: catalog !== null,
      owns: (id: string) =>
        catalog === null ? true : (catalog.get(id)?.owned ?? FREE_COSMETICS.has(id)),
      /** How to earn a locked cosmetic, e.g. "Reach level 8". */
      requirement: (id: string) => catalog?.get(id)?.requirement ?? null,
    }),
    [catalog],
  );
}
