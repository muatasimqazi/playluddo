"use client";

import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";

/**
 * Mixed party rooms (docs/COMPETITIVE_ROADMAP.md P8): a party table can have
 * some players in the living room and others joining from elsewhere. Asked
 * before the agreement, because a player joining from elsewhere gets voice
 * and so needs the full table agreement (decision 7), not the short one.
 */
export function PartyWhere({ onChoose }: { onChoose: (remote: boolean) => void }) {
  return (
    <main className="sim-entrance">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content party-where" aria-labelledby="party-where-heading">
        <span className="eyebrow">PARTY TABLE</span>
        <h1 id="party-where-heading">
          Where are you
          <br />
          <em>playing from?</em>
        </h1>
        <div className="party-where-choices">
          <button type="button" onClick={() => onChoose(false)}>
            <Icon name="users" size={22} />
            <strong>I&rsquo;m here at the TV</strong>
            <small>Your phone becomes your controller. The table is on the big screen.</small>
          </button>
          <button type="button" onClick={() => onChoose(true)}>
            <Icon name="link" size={22} />
            <strong>I&rsquo;m somewhere else</strong>
            <small>You get the full table on your own screen, and voice chat with the others.</small>
          </button>
        </div>
        <Link className="table-rules-back" href="/">
          Not now
        </Link>
      </section>
    </main>
  );
}
