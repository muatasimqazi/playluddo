import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { Icon } from "@/components/simulator/Icon";
import type { PlayerColor } from "@/lib/board/types";
import type { VisibleProfile } from "@/lib/supabase/profile";

const MODE_LABELS: Record<string, string> = {
  ludo: "Ludo",
  snakes_and_ladders: "Snakes & Ladders",
};

function modeLabel(mode: string) {
  return MODE_LABELS[mode] ?? mode;
}

function colourLabel(colour: PlayerColor) {
  return colour.charAt(0).toUpperCase() + colour.slice(1);
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
        {xp.toLocaleString()} XP · {(next - xp).toLocaleString()} to level {level + 1}
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
          <small>{isSelf ? "This is you" : "At the table"}</small>
        </div>
        <span className="profile-level" aria-label={`Level ${level}, ${xp} XP`}>
          <b>{level}</b>
          <small>LEVEL</small>
        </span>
      </div>

      <ProfileXpBar level={level} xp={xp} />

      {currentStreak > 0 && (
        <p className="profile-streak">
          <span className="profile-streak-flame" aria-hidden="true">🔥</span>
          <span>
            <strong>
              {currentStreak}-day streak
            </strong>
            <small>
              Longest {longestStreak}
              {isSelf && streakFreezes > 0
                ? ` · ${streakFreezes} freeze${streakFreezes === 1 ? "" : "s"}`
                : ""}
            </small>
          </span>
        </p>
      )}

      {!played ? (
        <p className="profile-stats-empty">
          No completed online games yet — {isSelf ? "your" : "their"} stats appear here after the
          first finished match.
        </p>
      ) : (
        <>
          <div className="profile-stats-grid">
            <div className="profile-stat">
              <span>{gamesPlayed}</span>
              <small>Games played</small>
            </div>
            <div className="profile-stat">
              <span>{winRate(wins, gamesPlayed)}</span>
              <small>Win rate</small>
            </div>
            <div className="profile-stat">
              <span>{wins}</span>
              <small>{wins === 1 ? "Win" : "Wins"}</small>
            </div>
            <div className="profile-stat">
              <span>{totalCaptures}</span>
              <small>Captures</small>
            </div>
            <div className="profile-stat">
              <span>{totalSixes}</span>
              <small>Sixes rolled</small>
            </div>
            <div className="profile-stat">
              <span className="profile-stat-colour">
                {favouriteColour ? (
                  <>
                    <i data-colour={favouriteColour} />
                    {colourLabel(favouriteColour)}
                  </>
                ) : (
                  "—"
                )}
              </span>
              <small>Favourite colour</small>
            </div>
          </div>

          {winRateByMode.length > 0 && (
            <section className="profile-stats-section">
              <span className="eyebrow">BY GAME</span>
              <ul className="profile-modes">
                {winRateByMode.map((row) => (
                  <li key={row.mode}>
                    <Icon name="dice" size={14} />
                    <span>{modeLabel(row.mode)}</span>
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
              Best comeback: won after <strong>{bestComeback}</strong> rolls without a six.
            </p>
          )}

          {headToHead.length > 0 && (
            <section className="profile-stats-section">
              <span className="eyebrow">HEAD-TO-HEAD</span>
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
                ACHIEVEMENTS · {unlockedCount} of {achievements.length}
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
