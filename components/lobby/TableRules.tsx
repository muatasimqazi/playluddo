"use client";



import { useT } from "@/lib/i18n";
import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

/**
 * Draft legal/consent translations require native and legal review.
 * One-time agreement before a player's first online table, where they can
 * chat and talk with people they may not know. See lib/community.ts.
 */
export function TableRules({ onAgree }: { onAgree: () => void }) {
  const tx = useT();
  return (
    <main className="sim-entrance">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content room-notice table-rules" aria-labelledby="table-rules-heading">
        <span className="eyebrow">{tx("agreement.eyebrow")}</span>
        <h1 id="table-rules-heading">
          <em>{tx("agreement.friendlyTitle")}</em>
        </h1>
        <ul>
          <li>{tx("agreement.conduct")}</li>
          <li>{tx("agreement.privateInformation")}</li>
          <li>{tx("agreement.reporting")}</li>
        </ul>
        <p className="table-rules-terms">
          <Link href="/terms">{tx("agreement.consent")}</Link>
        </p>
        <button type="button" className="sim-primary" onClick={onAgree}>
          <span>{tx("actions.agree")}</span>
          <Icon name="arrow" />
        </button>
        <Link className="table-rules-back" href="/">
          {tx("actions.notNow")}</Link>
      </section>
    </main>
  );
}
