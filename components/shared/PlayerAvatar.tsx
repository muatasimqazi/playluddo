import type { CSSProperties } from "react";
import { avatarForSeat, photoAvatar } from "@/lib/avatars/catalog";
import { COLORS } from "@/lib/presentation/board";
import type { Player } from "@/lib/board/types";

export function PlayerAvatar({
  player,
  size = 36,
  className = "",
  crowned = false,
  placement,
}: {
  player: Pick<Player, "avatarId" | "color" | "displayName" | "seatIndex">;
  size?: number;
  className?: string;
  crowned?: boolean;
  placement?: 1 | 2 | 3;
}) {
  const avatar = avatarForSeat(player.avatarId, player.seatIndex);
  const photo = photoAvatar(player.avatarId);
  const rank = placement ?? (crowned ? 1 : undefined);
  return (
    <span
      className={`player-avatar ${rank ? `is-place-${rank}` : ""} ${className}`}
      style={
        {
          "--player-avatar-color": COLORS[player.color],
          width: size,
          height: size,
        } as CSSProperties
      }
      role="img"
      aria-label={`${player.displayName}'s${rank ? ` place ${rank}` : ""} avatar`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP game portraits. */}
      <img
        src={avatar.portrait}
        alt=""
        className={photo ? "is-photo-avatar" : undefined}
        data-photo-style={photo?.style}
      />
      {rank === 1 && (
        <svg className="player-avatar-crown" viewBox="0 0 64 40" aria-hidden="true">
          <path d="M8 30 4 9l16 11L32 3l12 17L60 9l-4 21Z" />
          <path d="M9 31h46v6H9Z" />
          <circle cx="4" cy="8" r="3" />
          <circle cx="32" cy="3" r="3" />
          <circle cx="60" cy="8" r="3" />
        </svg>
      )}
      {(rank === 2 || rank === 3) && (
        <svg
          className={`player-avatar-laurel place-${rank}`}
          viewBox="0 0 72 72"
          aria-hidden="true"
        >
          <path d="M27 63C13 56 8 43 12 27M45 63c14-7 19-20 15-36" />
          <path d="m16 50-8-2 5 7m1-14-8-4 3 8m5-14-6-6 1 9m47 16 8-2-5 7m-1-14 8-4-3 8m-5-14 6-6-1 9" />
          <circle cx="36" cy="62" r="5" />
          <text x="36" y="66" textAnchor="middle">{rank}</text>
        </svg>
      )}
    </span>
  );
}
