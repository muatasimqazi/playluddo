"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { acceptPartyRules, partyRulesAccepted, deviceAgeBlocked } from "@/lib/community";
import { getAgeEligibility, type AgeEligibility } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/client";
import { AskAge, UnderAgeNotice } from "@/components/lobby/AgeCheck";
import { TableLoading } from "@/components/simulator/TableLoading";

/** P7 / decision 7: one agreement for players and audience, alongside age. */
export function PartyAgreement({ onAgree }: { onAgree: () => void }) {
  const router = useRouter();
  const [age, setAge] = useState<AgeEligibility | null>(null);
  const [error, setError] = useState(false);
  const [restricted, setRestricted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getAgeEligibility(createClient()).then((value) => {
      if (cancelled) return;
      setAge(value);
      if ((!value.required || value.online) && partyRulesAccepted()) onAgree();
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [onAgree]);
  const agree = () => { acceptPartyRules(); onAgree(); };
  if (error) return <main className="party-pad"><p role="alert">Couldn’t check your invitation. Please reload and try again.</p></main>;
  if (!age) return <TableLoading label="Opening your invitation…" />;
  if (restricted || (age.required && !age.online && (age.declared || deviceAgeBlocked()))) return <UnderAgeNotice />;
  if (age.required && !age.declared) return <AskAge partyAgreement onEligible={agree} onUnderAge={() => setRestricted(true)} onCancel={() => router.push("/")} />;
  return <PartyAgreementScreen onAgree={agree} />;
}

export function PartyAgreementScreen({ onAgree }: { onAgree: () => void }) {
  return <main className="sim-entrance">
    <div className="entrance-shade" />
    <section className="entrance-content room-notice table-rules" aria-labelledby="party-agreement-heading">
      <span className="eyebrow">BEFORE YOU JOIN THE PARTY</span>
      <h1 id="party-agreement-heading">Be kind, and use a <em>friendly name.</em></h1>
      <p className="table-rules-terms">By continuing you agree to the <Link href="/terms">Terms of Use</Link>.</p>
      <button type="button" className="sim-primary" onClick={onAgree}>I agree</button>
      <Link className="table-rules-back" href="/">Not now</Link>
    </section>
  </main>;
}
