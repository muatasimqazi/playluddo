"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { Icon } from "@/components/simulator/Icon";
import { BRAND } from "@/lib/brand";
import { getTeamSeason, type TeamSeason } from "@/lib/supabase/seasons";
import { useI18n, type LocaleCode, type Translator } from "@/lib/i18n";

function formatWeek(startISO: string, endISO: string, locale: LocaleCode): string {
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const day = (d: Date, withMonth: boolean) =>
    d.toLocaleDateString(locale, {
      timeZone: "UTC",
      day: "numeric",
      ...(withMonth ? { month: "short" } : {}),
    });
  return `${day(start, !sameMonth)} – ${day(end, true)}`;
}

/** The one-line story of the season, reused in the card and the shared image. */
function headline(t: Translator, season: TeamSeason): string {
  const leader = season.champion ?? season.standings[0] ?? null;
  if (!leader) return t("leaderboard.noGamesWeek");
  const record = t("leaderboard.headlineRecord", { wins: leader.wins, played: leader.played });
  return season.isCurrent
    ? t("leaderboard.leadsWith", { name: leader.displayName, record })
    : t("leaderboard.wonThisWeek", { name: leader.displayName, record });
}

/** Draws the recap card to a PNG so it can be shared to social media (F4.2). */
function drawRecap(
  t: Translator,
  locale: LocaleCode,
  season: TeamSeason,
  teamName: string,
): Promise<Blob | null> {
  const size = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  const pad = 96;

  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, "#2c3d31");
  bg.addColorStop(1, "#16221a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#dcca9f";
  ctx.font = "600 34px system-ui, -apple-system, sans-serif";
  ctx.fillText(BRAND.name.toUpperCase(), pad, 150);

  ctx.fillStyle = "#f3f4e8";
  ctx.font = "700 92px system-ui, -apple-system, sans-serif";
  const name = teamName.length > 16 ? `${teamName.slice(0, 15)}…` : teamName;
  ctx.fillText(name, pad, 260);

  ctx.fillStyle = "#a9b6a0";
  ctx.font = "400 40px system-ui, -apple-system, sans-serif";
  ctx.fillText(
    `${season.isCurrent ? t("leaderboard.thisWeek") : t("leaderboard.season")} · ${formatWeek(season.seasonStart, season.seasonEnd, locale)}`,
    pad,
    322,
  );

  // Headline, wrapped to the card width.
  ctx.fillStyle = "#f3f4e8";
  ctx.font = "600 58px system-ui, -apple-system, sans-serif";
  const words = headline(t, season).split(" ");
  let line = "";
  let y = 470;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > size - pad * 2 && line) {
      ctx.fillText(line, pad, y);
      line = word;
      y += 74;
    } else line = test;
  }
  ctx.fillText(line, pad, y);

  // Top standings.
  const medals = ["#e8c766", "#cdd2c4", "#c69a6b"];
  let row = Math.max(y + 120, 640);
  for (const entry of season.standings.slice(0, 5)) {
    ctx.fillStyle = medals[entry.rank - 1] ?? "#8f9a86";
    ctx.font = "700 48px system-ui, -apple-system, sans-serif";
    ctx.fillText(String(entry.rank), pad, row);
    ctx.fillStyle = "#e6e7d6";
    ctx.font = "500 48px system-ui, -apple-system, sans-serif";
    ctx.fillText(entry.displayName, pad + 84, row);
    ctx.fillStyle = "#a9b6a0";
    ctx.font = "400 40px system-ui, -apple-system, sans-serif";
    const record = `${entry.wins}/${entry.played}`;
    ctx.fillText(record, size - pad - ctx.measureText(record).width, row);
    row += 84;
  }

  ctx.fillStyle = "#7f8b78";
  ctx.font = "400 34px system-ui, -apple-system, sans-serif";
  ctx.fillText(BRAND.url.replace(/^https?:\/\//, ""), pad, size - 80);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function TeamSeasonPanel({
  client,
  teamId,
  teamName,
  weeksAgo,
  myUserId,
}: {
  client: SupabaseClient;
  teamId: string;
  teamName: string;
  weeksAgo: number;
  myUserId: string | null;
}) {
  const { t, locale } = useI18n();
  const [season, setSeason] = useState<TeamSeason | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getTeamSeason(client, teamId, weeksAgo);
        if (!cancelled) setSeason(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t("leaderboard.seasonLoadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // `t` only feeds the catch fallback; excluding it avoids a locale-change reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, teamId, weeksAgo]);

  async function shareRecap() {
    if (!season) return;
    setSharing(true);
    try {
      const blob = await drawRecap(t, locale, season, teamName);
      if (!blob) return;
      const file = new File([blob], `${teamName}-season.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: headline(t, season) });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(t("leaderboard.shareError"));
    } finally {
      setSharing(false);
    }
  }

  if (loading)
    return (
      <div className="leaderboard-loading" aria-label={t("leaderboard.loadingSeason")}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
    );
  if (error)
    return (
      <p role="alert" className="leaderboard-message is-error">
        {error}
      </p>
    );
  if (!season) return null;

  return (
    <div className="season-panel">
      <div className="season-head">
        <div>
          <span className="eyebrow">
            {season.isCurrent ? t("leaderboard.thisWeek").toUpperCase() : t("leaderboard.season").toUpperCase()}
          </span>
          <strong>{formatWeek(season.seasonStart, season.seasonEnd, locale)}</strong>
        </div>
        {season.champion && (
          <span className="season-champion-badge">
            <Icon name="trophy" size={15} />
            {t("tournaments.champion")}
          </span>
        )}
      </div>

      <p className="season-headline">{headline(t, season)}</p>

      {season.standings.length === 0 ? (
        <p className="leaderboard-message">{t("leaderboard.seasonEmpty")}</p>
      ) : (
        <>
          <ol className="season-standings">
            {season.standings.map((entry) => (
              <li
                key={entry.userId}
                className={entry.userId === myUserId ? "is-me" : undefined}
              >
                <span className="season-rank">{entry.rank}</span>
                <PlayerAvatar
                  player={{
                    displayName: entry.displayName,
                    avatarId: entry.avatarId ?? undefined,
                    color: "blue",
                    seatIndex: entry.rank,
                  }}
                  size={30}
                  placement={
                    !season.isCurrent && entry.rank <= 3
                      ? (entry.rank as 1 | 2 | 3)
                      : undefined
                  }
                />
                <span className="season-name">
                  {entry.displayName}
                  {entry.userId === myUserId && (
                    <small className="leaderboard-you">{t("leaderboard.you").toUpperCase()}</small>
                  )}
                </span>
                <span className="season-record">
                  <strong>{entry.wins}</strong> {t("leaderboard.of")} {entry.played}
                </span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="season-share"
            onClick={() => void shareRecap()}
            disabled={sharing}
          >
            <Icon name="share" size={15} />
            {sharing ? t("leaderboard.preparing") : t("leaderboard.shareRecap")}
          </button>
        </>
      )}
    </div>
  );
}
