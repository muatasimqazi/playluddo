"use client";

// Tournament detail (F4.1). A query-param route (`/tournaments/view?id=…`)
// rather than a `[id]` path segment, so it prerenders under the Capacitor
// static export (`output: "export"`) — arbitrary, user-created tournament IDs
// can't be enumerated for generateStaticParams. Matches /replay and /watch.
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BracketView } from "@/components/tournament/BracketView";
import { Icon } from "@/components/simulator/Icon";
import { TableLoading } from "@/components/simulator/TableLoading";
import { useI18n } from "@/lib/i18n";
import "@/components/simulator/simulator.css";

function Tournament() {
  const { t } = useI18n();
  const id = useSearchParams().get("id");
  if (!id)
    return (
      <div className="replay-message" role="alert">
        <p>{t("tournaments.noTournament")}</p>
        <Link href="/tournaments" className="sim-primary">
          {t("tournaments.allTournaments")}
        </Link>
      </div>
    );
  return <BracketView tournamentId={id} />;
}

export default function TournamentPage() {
  const { t } = useI18n();
  return (
    <main className="sim-entrance leaderboard-page">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <Link href="/" className="sim-brand" aria-label={t("actions.homeLabel")}>
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
          <small>{t("tournaments.allTournaments")}</small>
        </Link>
      </header>
      <Suspense fallback={<TableLoading label={t("tournaments.loadingTournament")} />}>
        <Tournament />
      </Suspense>
    </main>
  );
}
