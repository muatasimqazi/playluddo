"use client";



import { useI18n, useT } from "@/lib/i18n";


import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/simulator/Icon";
import { createClient } from "@/lib/supabase/client";
import { declareAge, getAgeEligibility, RpcError } from "@/lib/supabase/rpc";
import { blockDeviceUntil, deviceAgeBlocked } from "@/lib/community";
import "@/components/simulator/simulator.css";

/**
 * The 13+ age check for online play (docs/COMPETITIVE_ROADMAP.md F0.4).
 * The server decides when it's needed: every way into an online table
 * fails with AGE_REQUIRED (ask) or AGE_RESTRICTED (under 13), and only
 * while its online_age_check flag is on. useAgeCheck turns those errors
 * into this screen, then retries what the player was doing.
 */



function Backdrop({ children }: { children: ReactNode }) {
  return (
    <main className="sim-entrance age-check">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      {children}
    </main>
  );
}

/**
 * A neutral age screen: month and year pickers with nothing pre-filled, no
 * hint of the age required, and no yes/no question to click through.
 */
export function AskAge({
  onEligible,
  onUnderAge,
  onCancel,
  partyAgreement = false,
}: {
  onEligible: () => void;
  onUnderAge: () => void;
  onCancel: () => void;
  partyAgreement?: boolean;
}) {
  const { t: tx, locale } = useI18n();
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, month, 1))));
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 1900 + 1 }, (_, i) => thisYear - i);

  async function submit() {
    if (!month || !year) {
      setError(tx("age.chooseBirth"));
      return;
    }
    setPending(true);
    setError(null);
    const client = createClient();
    try {
      let result;
      try {
        result = await declareAge(client, Number(year), Number(month));
      } catch (e) {
        // Answered already, e.g. in another tab: go by that answer.
        if (e instanceof RpcError && e.code === "AGE_ALREADY_DECLARED")
          result = await getAgeEligibility(client);
        else throw e;
      }
      if (result.online) onEligible();
      else {
        if (result.eligibleFrom) blockDeviceUntil(result.eligibleFrom);
        onUnderAge();
      }
    } catch (e) {
      setError(
        e instanceof RpcError && e.code === "INVALID_BIRTH_DATE"
          ? tx("age.invalidDate")
          : tx("age.saveError"),
      );
      setPending(false);
    }
  }

  return (
    <Backdrop>
      <section className="entrance-content room-notice table-rules" aria-labelledby="age-check-heading">
        <span className="eyebrow">{tx("age.eyebrow")}</span>
        <h1 id="age-check-heading">
          <em>{tx("age.birthQuestion")}</em>
        </h1>
        <p className="table-rules-terms">
          {tx("age.retention")}</p>
        <div className="age-check-fields">
          <label>
            <span className="eyebrow">{tx("age.month")}</span>
            <select value={month} disabled={pending} onChange={(e) => setMonth(e.target.value)}>
              <option value="" disabled>
                {tx("age.month")}</option>
              {months.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="eyebrow">{tx("age.year")}</span>
            <select dir="ltr" value={year} disabled={pending} onChange={(e) => setYear(e.target.value)}>
              <option value="" disabled>
                {tx("age.year")}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* Draft consent translation requires native/legal review. */}
        {partyAgreement && <p className="table-rules-terms"><Link href="/terms">{tx("agreement.partyConsent")}</Link></p>}
        {error && (
          <p className="age-check-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="sim-primary" disabled={pending} onClick={() => void submit()}>
          <span>{pending ? tx("actions.wait") : tx("common.continue")}</span>
          <Icon name="arrow" />
        </button>
        <button type="button" className="table-rules-back" onClick={onCancel}>
          {tx("actions.notNow")}</button>
      </section>
    </Backdrop>
  );
}

/** Under 13: no online tables, but the offline games are right here. */
export function UnderAgeNotice() {
  const tx = useT();
  return (
    <Backdrop>
      <section className="entrance-content room-notice table-rules" role="alert">
        <span className="eyebrow">{tx("age.onlineTables")}</span>
        <h1>
          <em>{tx("age.minimumAge")}</em>
        </h1>
        <p className="table-rules-terms">
          {tx("age.offlineAlternative")}</p>
        <Link className="sim-primary" href="/practice">
          <span>{tx("age.computer")}</span>
          <Icon name="arrow" />
        </Link>
        <Link className="table-rules-back age-check-secondary" href="/table-together">
          {tx("age.together")}</Link>
        <Link className="table-rules-back" href="/">
          {tx("actions.backEntrance")}</Link>
      </section>
    </Backdrop>
  );
}

/**
 * For a page that is itself blocked by AGE_REQUIRED (a room link, say):
 * ask, then call onEligible to try again. "Not now" goes home.
 */
export function AgeRequired({ onEligible }: { onEligible: () => void }) {
  const router = useRouter();
  const [restricted, setRestricted] = useState(deviceAgeBlocked);
  if (restricted) return <UnderAgeNotice />;
  return (
    <AskAge
      onEligible={onEligible}
      onUnderAge={() => setRestricted(true)}
      onCancel={() => router.push("/")}
    />
  );
}

type Gate = { kind: "ask"; retry: () => void } | { kind: "restricted" };

/**
 * Wraps any action that seats a player online. Call `handle(error, retry)`
 * in its catch: it returns true (and takes over the screen) for the age
 * errors, false for anything else. Render `gate` wherever the page renders.
 */
export function useAgeCheck() {
  const [gate, setGate] = useState<Gate | null>(null);

  // Stable, so effects can call it without re-running.
  const handle = useCallback((error: unknown, retry: () => void) => {
    if (!(error instanceof RpcError)) return false;
    if (error.code === "AGE_RESTRICTED") {
      setGate({ kind: "restricted" });
      return true;
    }
    if (error.code === "AGE_REQUIRED") {
      // A device that already gave an under-13 answer takes no new ones.
      setGate(deviceAgeBlocked() ? { kind: "restricted" } : { kind: "ask", retry });
      return true;
    }
    return false;
  }, []);

  const node =
    gate?.kind === "ask" ? (
      <AskAge
        onEligible={() => {
          setGate(null);
          gate.retry();
        }}
        onUnderAge={() => setGate({ kind: "restricted" })}
        onCancel={() => setGate(null)}
      />
    ) : gate?.kind === "restricted" ? (
      <UnderAgeNotice />
    ) : null;

  return { gate: node, handle };
}
