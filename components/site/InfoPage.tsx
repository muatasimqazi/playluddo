"use client";

import { useT } from "@/lib/i18n";
import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import "@/components/simulator/simulator.css";

import { SUPPORT_EMAIL } from "@/lib/support";

/**
 * Shell for text pages (privacy policy, support): the entrance's apartment
 * backdrop and header, with a readable glass column that scrolls as a page.
 * Client shell translates navigation; server page content remains children.
 */
export function InfoPage({
  eyebrow,
  title,
  accent,
  intro,
  children,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  accent: React.ReactNode;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tx = useT();
  return (
    <main className="sim-entrance info-page">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand" aria-label={tx("actions.homeLabel")}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            LUDDO<small>HOUSE</small>
          </span>
        </Link>
        <Link href="/" className="profile-trigger leaderboard-back">
          <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
          <small>{tx("actions.backHome")}</small>
        </Link>
        <LanguageSwitcher className="profile-trigger" />
      </header>
      <article className="info-content">
        <span className="eyebrow">{eyebrow}</span>
        <h1>
          {title} <em>{accent}</em>
        </h1>
        {intro && <p className="info-intro">{intro}</p>}
        <div className="info-body">{children}</div>
        <footer className="info-footer">
          <Link href="/how-to-play">{tx("actions.howToPlay")}</Link>
          <span aria-hidden>·</span>
          <Link href="/support">{tx("common.support")}</Link>
          <span aria-hidden>·</span>
          <Link href="/privacy">{tx("common.privacy")}</Link>
          <span aria-hidden>·</span>
          <Link href="/terms">{tx("actions.termsShort")}</Link>
          <span aria-hidden>·</span>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </footer>
      </article>
    </main>
  );
}
