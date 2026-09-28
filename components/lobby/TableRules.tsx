import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

/**
 * One-time agreement before a player's first online table, where they can
 * chat and talk with people they may not know. See lib/community.ts.
 */
export function TableRules({ onAgree }: { onAgree: () => void }) {
  return (
    <main className="sim-entrance">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content room-notice table-rules" aria-labelledby="table-rules-heading">
        <span className="eyebrow">BEFORE YOU SIT DOWN</span>
        <h1 id="table-rules-heading">
          Keep the table
          <br />
          <em>friendly.</em>
        </h1>
        <ul>
          <li>Be kind. No harassment, hate, threats, or sexual content — in chat, voice, or your name.</li>
          <li>Don&rsquo;t share personal information, yours or anyone else&rsquo;s.</li>
          <li>
            Open <strong>Chat</strong> at the table to <strong>block</strong> or <strong>report</strong> anyone.
            We review reports within 24 hours and remove people who break the rules.
          </li>
        </ul>
        <p className="table-rules-terms">
          By continuing you agree to the <Link href="/terms">Terms of Use</Link>, which have zero tolerance for
          objectionable content or abusive players.
        </p>
        <button type="button" className="sim-primary" onClick={onAgree}>
          <span>I agree</span>
          <Icon name="arrow" />
        </button>
        <Link className="table-rules-back" href="/">
          Not now
        </Link>
      </section>
    </main>
  );
}
