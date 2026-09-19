import type { CSSProperties } from "react";
import { avatarForSeat } from "@/lib/avatars/catalog";
import { COLORS } from "@/lib/presentation/board";
import type { Player } from "@/lib/board/types";

export function PlayerAvatar({
  player,
  size = 36,
  className = "",
}: {
  player: Pick<Player, "avatarId" | "color" | "displayName" | "seatIndex">;
  size?: number;
  className?: string;
}) {
  const avatar = avatarForSeat(player.avatarId, player.seatIndex);
  return (
    <span
      className={`player-avatar ${className}`}
      style={
        {
          "--player-avatar-color": COLORS[player.color],
          width: size,
          height: size,
        } as CSSProperties
      }
      role="img"
      aria-label={`${player.displayName}'s avatar`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP game portraits. */}
      <img src={avatar.portrait} alt="" />
    </span>
  );
}
