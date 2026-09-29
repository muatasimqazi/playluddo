import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

export const SUPPORT_EMAIL = "support@luddohouse.com";

/**
 * Shell for text pages (privacy policy, support): the entrance's apartment
 * backdrop and header, with a readable glass column that scrolls as a page.
 * A server component — these pages are plain content with no client state.
 */
export function InfoPage({
  eyebrow,
  title,
  accent,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="sim-entrance info-page">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand" aria-label="Luddo House home">
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
          <small>Back to the apartment</small>
        </Link>
      </header>
      <article className="info-content">
        <span className="eyebrow">{eyebrow}</span>
        <h1>
          {title} <em>{accent}</em>
        </h1>
        {intro && <p className="info-intro">{intro}</p>}
        <div className="info-body">{children}</div>
        <footer className="info-footer">
          <Link href="/how-to-play">How to play</Link>
          <span aria-hidden>·</span>
          <Link href="/support">Support</Link>
          <span aria-hidden>·</span>
          <Link href="/privacy">Privacy</Link>
          <span aria-hidden>·</span>
          <Link href="/terms">Terms</Link>
          <span aria-hidden>·</span>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </footer>
      </article>
    </main>
  );
}
