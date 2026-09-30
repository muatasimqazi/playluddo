"use client";

/**
 * Asks a newly signed-in account for its birth month and year (F0.4), right
 * after Apple/Google sign-in instead of lazily at the first online table. The
 * same declaration powers video eligibility (Section 7, V0), so signing in and
 * being 18+ is all it takes — there's no separate video question.
 *
 * Mounted once near the root (app/layout.tsx). It watches auth state and, when
 * a non-anonymous user appears without a declaration, overlays the existing
 * AskAge screen. Guests are never asked here — only when they reach an online
 * table (useAgeCheck) — so this ties every proactive prompt to a real account.
 *
 * Flag-gated: getAgeEligibility().required is false while online_age_check is
 * off, so nothing shows until that server switch is on.
 */
import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getAgeEligibility } from "@/lib/supabase/rpc";
import { isSignedIn } from "@/lib/preferences";
import { AskAge, UnderAgeNotice } from "@/components/lobby/AgeCheck";

type Gate = "ask" | "restricted" | null;

export function AgeGateOnSignIn() {
  const [gate, setGate] = useState<Gate>(null);
  // Answered or dismissed once — don't re-prompt for the rest of this session.
  // A fresh mount (next app open) checks again, so an unanswered account is
  // asked until it declares, without nagging mid-session.
  const handled = useRef(false);

  useEffect(() => {
    const client = createClient();

    const check = async (user: User | null) => {
      if (handled.current || !isSignedIn(user)) return;
      try {
        const eligibility = await getAgeEligibility(client);
        if (!eligibility.required) return; // flag off → never ask
        handled.current = true;
        if (!eligibility.declared) setGate("ask");
      } catch {
        /* A failed check just means we ask again later; never block the app. */
      }
    };

    // INITIAL_SESSION fires on subscribe, covering an already-signed-in user
    // (e.g. returning from the web OAuth redirect) as well as a fresh SIGNED_IN.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      void check(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!gate) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60 }}
      role="dialog"
      aria-modal="true"
    >
      {gate === "ask" ? (
        <AskAge
          onEligible={() => setGate(null)}
          onUnderAge={() => setGate("restricted")}
          onCancel={() => setGate(null)}
        />
      ) : (
        <UnderAgeNotice />
      )}
    </div>
  );
}
