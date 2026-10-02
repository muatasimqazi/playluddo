"use client";

import { useEffect } from "react";
import { trackError } from "@/lib/analytics";
import Link from "next/link";
import { Icon } from "@/components/simulator/Icon";
import { useI18n, type MessageKey } from "@/lib/i18n";
import "@/components/simulator/simulator.css";

// Room errors arrive as the server's RPC error codes; say what happened in
// the app's own voice (and language) instead of showing "ROOM_NOT_FOUND".
// Each code maps to its localized title (two lines) and body keys.
const NOTICE_KEYS: Record<
  string,
  { line1: MessageKey; em: MessageKey; body: MessageKey }
> = {
  ROOM_NOT_FOUND: {
    line1: "lobby.noticeRoomNotFound1",
    em: "lobby.noticeRoomNotFoundEm",
    body: "lobby.noticeRoomNotFoundBody",
  },
  ROOM_FULL: {
    line1: "lobby.noticeRoomFull1",
    em: "lobby.noticeRoomFullEm",
    body: "lobby.noticeRoomFullBody",
  },
  ALREADY_STARTED: {
    line1: "lobby.noticeStarted1",
    em: "lobby.noticeStartedEm",
    body: "lobby.noticeStartedBody",
  },
  UNAUTHENTICATED: {
    line1: "lobby.noticeUnauth1",
    em: "lobby.noticeUnauthEm",
    body: "lobby.noticeUnauthBody",
  },
};

const DEFAULT_KEYS = {
  line1: "lobby.noticeDefault1",
  em: "lobby.noticeDefaultEm",
  body: "lobby.noticeDefaultBody",
} as const;

export function RoomNotice({ code }: { code: string }) {
  // Counted as a code from the allow-list; age codes are never reported.
  useEffect(() => {
    trackError("room_access", code);
  }, [code]);
  const { t } = useI18n();
  const keys = NOTICE_KEYS[code] ?? DEFAULT_KEYS;
  return (
    <main className="sim-entrance">
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <section className="entrance-content room-notice" role="alert">
        {/* The brand wordmark is intentionally not translated. */}
        <span className="eyebrow">LUDDO HOUSE</span>
        <h1>
          {t(keys.line1)}
          <br />
          <em>{t(keys.em)}</em>
        </h1>
        <p>{t(keys.body)}</p>
        <Link className="sim-primary" href="/">
          <span>{t("actions.backHome")}</span>
          <Icon name="arrow" />
        </Link>
      </section>
    </main>
  );
}
