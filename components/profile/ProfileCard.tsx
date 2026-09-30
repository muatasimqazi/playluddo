"use client";

import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { Icon } from "@/components/simulator/Icon";
import type { PlayerColor } from "@/lib/board/types";
import type { VisibleProfile } from "@/lib/supabase/profile";
import { useI18n, type Translator } from "@/lib/i18n";

const MODE_KEYS: Record<string, "entrance.ludo" | "entrance.snakes"> = {
  ludo: "entrance.ludo",
  snakes_and_ladders: "entrance.snakes",
};

function modeLabel(t: Translator, mode: string) {
  const key = MODE_KEYS[mode];
  return key ? t(key) : mode;
}

const COLOUR_KEYS: Record<PlayerColor, "colors.red" | "colors.green" | "colors.yellow" | "colors.blue"> = {
  red: "colors.red",
  green: "colors.green",
  yellow: "colors.yellow",
  blue: "colors.blue",
};

function colourLabel(t: Translator, colour: PlayerColor) {
  const label = t(COLOUR_KEYS[colour]);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function winRate(wins: number, games: number) {
  if (games === 0) return "—";
  return `${Math.round((wins / games) * 100)}%`;
}

/** XP at which a level begins — mirrors private.xp_level_for in SQL: level L
 * starts at 100 * L*(L-1)/2 XP. */
function xpForLevelStart(level: number) {
  return (100 * level * (level - 1)) / 2;
}

/** Progress toward the next level (F3.2). */
function ProfileXpBar({ level, xp }: { level: number; xp: number }) {
  const { t, locale } = useI18n();
  const start = xpForLevelStart(level);
  const next = xpForLevelStart(level + 1);
  const into = xp - start;
  const span = next - start;
  const pct = span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 0;
  return (
    <div className="profile-xp">
      <div className="profile-xp-track" role="progressbar" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <small>
        {t("profile.xpProgress", {
          xp: xp.toLocaleString(locale),
          remaining: (next - xp).toLocaleString(locale),
          level: level + 1,
        })}
      </small>
    </div>
  );
}

/**
 * A player's stats (docs/COMPETITIVE_ROADMAP.md F3.1), shown on their own
 * profile page and in the seat-avatar profile modal. Purely presentational:
 * it renders a profile the caller is already allowed to see.
 */
export function ProfileCard({ profile }: { profile: VisibleProfile }) {
  const { t } = useI18n();
  const {
    displayName,
    avatarId,
    level,
    xp,
    currentStreak,
    longestStreak,
    streakFreezes,
    gamesPlayed,
    wins,
    winRateByMode,
    totalCaptures,
    totalSixes,
    favouriteColour,
    bestComeback,
    headToHead,
    achievements,
    isSelf,
  } = profile;
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const played = gamesPlayed > 0;

  return (
    <div className="profile-stats">
      <div className="profile-stats-head">
        <PlayerAvatar
          player={{
            avatarId: avatarId ?? undefined,
            color: favouriteColour ?? "blue",
            displayName,
            seatIndex: 0,
          }}
          size={56}
        />
        <div>
          <strong>{displayName}</strong>
          <small>{isSelf ? t("profile.thisIsYou") : t("profile.atTheTable")}</small>
        </div>
        <span className="profile-level" aria-label={t("profile.levelAria", { level, xp })}>
          <b>{level}</b>
          <small>{t("profile.levelLabel").toUpperCase()}</small>
        </span>
      </div>

      <ProfileXpBar level={level} xp={xp} />

      {currentStreak > 0 && (
        <p className="profile-streak">
          <span className="profile-streak-flame" aria-hidden="true">🔥</span>
          <span>
            <strong>{t("profile.streakDays", { count: currentStreak })}</strong>
            <small>
              {t("profile.streakLongest", { count: longestStreak })}
              {isSelf && streakFreezes > 0
                ? ` · ${t(streakFreezes === 1 ? "profile.freezeOne" : "profile.freezeOther", { count: streakFreezes })}`
                : ""}
            </small>
          </span>
        </p>
      )}

      {!played ? (
        <p className="profile-stats-empty">
          {isSelf ? t("profile.noGamesSelf") : t("profile.noGamesOther")}
        </p>
      ) : (
        <>
          <div className="profile-stats-grid">
            <div className="profile-stat">
              <span>{gamesPlayed}</span>
              <small>{t("profile.statGamesPlayed")}</small>
            </div>
            <div className="profile-stat">
              <span>{winRate(wins, gamesPlayed)}</span>
              <small>{t("profile.statWinRate")}</small>
            </div>
            <div className="profile-stat">
              <span>{wins}</span>
              <small>{wins === 1 ? t("profile.statWin") : t("profile.statWins")}</small>
            </div>
            <div className="profile-stat">
              <span>{totalCaptures}</span>
              <small>{t("profile.statCaptures")}</small>
            </div>
            <div className="profile-stat">
              <span>{totalSixes}</span>
              <small>{t("profile.statSixes")}</small>
            </div>
            <div className="profile-stat">
              <span className="profile-stat-colour">
                {favouriteColour ? (
                  <>
                    <i data-colour={favouriteColour} />
                    {colourLabel(t, favouriteColour)}
                  </>
                ) : (
                  "—"
                )}
              </span>
              <small>{t("profile.statFavColour")}</small>
            </div>
          </div>

          {winRateByMode.length > 0 && (
            <section className="profile-stats-section">
              <span className="eyebrow">{t("profile.byGame").toUpperCase()}</span>
              <ul className="profile-modes">
                {winRateByMode.map((row) => (
                  <li key={row.mode}>
                    <Icon name="dice" size={14} />
                    <span>{modeLabel(t, row.mode)}</span>
                    <strong>
                      {winRate(row.wins, row.games)}
                      <small>
                        {row.wins}/{row.games}
                      </small>
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {bestComeback > 0 && (
            <p className="profile-comeback">
              <Icon name="trophy" size={14} />
              {t("profile.comebackPre")} <strong>{bestComeback}</strong> {t("profile.comebackPost")}
            </p>
          )}

          {headToHead.length > 0 && (
            <section className="profile-stats-section">
              <span className="eyebrow">{t("profile.headToHead").toUpperCase()}</span>
              <ul className="profile-rivals">
                {headToHead.map((rival, index) => (
                  <li key={`${rival.displayName}-${index}`}>
                    <PlayerAvatar
                      player={{
                        avatarId: rival.avatarId ?? undefined,
                        color: "blue",
                        displayName: rival.displayName,
                        seatIndex: index,
                      }}
                      size={28}
                    />
                    <span>{rival.displayName}</span>
                    <strong>
                      {rival.wins}
                      <small>–{rival.games - rival.wins}</small>
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {achievements.length > 0 && (
            <section className="profile-stats-section">
              <span className="eyebrow">
                {t("profile.achievements", { unlocked: unlockedCount, total: achievements.length }).toUpperCase()}
              </span>
              <ul className="profile-achievements">
                {achievements.map((a) => (
                  <li
                    key={a.id}
                    className={a.unlocked ? "is-unlocked" : "is-locked"}
                    title={a.description}
                  >
                    <span className="profile-achievement-mark" aria-hidden="true">
                      {a.unlocked ? "★" : "☆"}
                    </span>
                    <span>
                      <strong>{a.name}</strong>
                      <small>{a.description}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
