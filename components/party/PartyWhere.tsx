"use client";

import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";
import { useI18n } from "@/lib/i18n";

/**
 * Mixed party rooms (docs/COMPETITIVE_ROADMAP.md P8): a party table can have
 * some players in the living room and others joining from elsewhere. Asked
 * before the agreement, because a player joining from elsewhere gets voice
 * and so needs the full table agreement (decision 7), not the short one.
 */
export function PartyWhere({ onChoose }: { onChoose: (remote: boolean) => void }) {
  const { t } = useI18n();
  return (
    <main className="sim-entrance">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content party-where" aria-labelledby="party-where-heading">
        <span className="eyebrow">{t("lobby.partyEyebrow").toUpperCase()}</span>
        <h1 id="party-where-heading">
          {t("party.whereTitle1")}
          <br />
          <em>{t("party.whereTitleEm")}</em>
        </h1>
        <div className="party-where-choices">
          <button type="button" onClick={() => onChoose(false)}>
            <Icon name="users" size={22} />
            <strong>{t("party.hereAtTv")}</strong>
            <small>{t("party.hereAtTvNote")}</small>
          </button>
          <button type="button" onClick={() => onChoose(true)}>
            <Icon name="link" size={22} />
            <strong>{t("party.elsewhere")}</strong>
            <small>{t("party.elsewhereNote")}</small>
          </button>
        </div>
        <Link className="table-rules-back" href="/">
          {t("party.notNow")}
        </Link>
      </section>
    </main>
  );
}
