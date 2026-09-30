import Link from "next/link";
import { BracketView } from "@/components/tournament/BracketView";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

export default async function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="sim-entrance leaderboard-page">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand" aria-label="Back to the apartment">
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
        <Link href="/tournaments" className="profile-trigger leaderboard-back">
          <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
          <small>All tournaments</small>
        </Link>
      </header>
      <BracketView tournamentId={id} />
    </main>
  );
}
