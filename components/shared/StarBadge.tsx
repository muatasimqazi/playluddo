import { QUADRANT_CLASSES } from "@/components/shared/colors";
import type { PlayerColor } from "@/lib/board/types";

/**
 * The circular star badge used all over
 * designs/apple_inspired_ludo_arena_with_translucent_glass_pieces/screen.png
 * — parking spots, the home-lane run, and the safe-cell markers on the
 * shared track all reuse this exact motif (white or tinted circle, a
 * colored 5-point star). One shared component keeps every use pixel-
 * consistent instead of redrawing the star per call site.
 */
export function StarBadge({
  color,
  size = 16,
  filled = false,
}: {
  color: PlayerColor;
  size?: number;
  /** Home-lane cells: a solid tinted disc. Safe-cell/parking spots: a plain white disc — matches the reference's two star treatments. */
  filled?: boolean;
}) {
  const classes = QUADRANT_CLASSES[color];
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${
        filled ? classes.tint : "bg-white"
      } ${classes.border} border`}
      style={{ width: size, height: size }}
    >
      <StarIcon className={classes.text} size={size * 0.62} />
    </span>
  );
}

export function StarIcon({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className} aria-hidden>
      <path d="M11.48 3.5a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  );
}
