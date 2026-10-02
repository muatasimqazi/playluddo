import type { Metadata } from "next";
import { Suspense } from "react";
import { InfoPage } from "@/components/site/InfoPage";
import { LudoRules, OnlineTableRules, SnakesRules } from "@/components/site/GameRules";
import { TableRulesNote } from "@/components/site/TableRulesNote";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `How to Play – ${BRAND.name}`,
  description: `The rules of Luddo and Snakes & Ladders at ${BRAND.name}, including house rules.`,
  alternates: { canonical: "/how-to-play" },
};

export default function HowToPlayPage() {
  return (
    <InfoPage eyebrow="HOW TO PLAY" title="Pull up a chair," accent="here's how.">
      {/* Opened from a table, this names that table's house rules. The link
          carries them in the query string, read on the client so the rest of
          the page still renders ahead of time. */}
      <Suspense fallback={null}>
        <TableRulesNote />
      </Suspense>
      <h2 id="ludo">Luddo</h2>
      <LudoRules />
      <h2 id="snakes-and-ladders">Snakes &amp; Ladders</h2>
      <SnakesRules />
      <h2 id="online">Playing online</h2>
      <OnlineTableRules />
    </InfoPage>
  );
}
