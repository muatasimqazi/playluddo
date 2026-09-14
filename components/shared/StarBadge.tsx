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
  size?: number | string;
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
      <StarIcon className={classes.text} size="72%" />
    </span>
  );
}

export const STAR_PATH =
  "M11.48 3.5a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.562.562 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z";

export function StarIcon({
  className,
  size = 16,
  x,
  y,
  width,
  height,
  fill = "currentColor",
}: {
  className?: string;
  size?: number | string;
  /** Positions this as a nested SVG viewport — set when embedding directly inside a parent <svg> (e.g. BoardArtwork), instead of `size` standalone sizing. */
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  fill?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      x={x}
      y={y}
      width={width ?? size}
      height={height ?? size}
      fill={fill}
      className={className}
      aria-hidden
    >
      <path d={STAR_PATH} />
    </svg>
  );
}

// Sparkle positions around CompassEmblem, in the same 0-100 viewBox space.
const SPARKLE_POSITIONS: readonly (readonly [number, number])[] = [
  [50, 24],
  [73, 43],
  [64, 72],
  [36, 72],
  [27, 43],
];

function polarPoint(cx: number, cy: number, radius: number, degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  const x = cx + radius * Math.cos(radians);
  const y = cy + radius * Math.sin(radians);
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

function starPolygonPath(cx: number, cy: number, outerRadius: number, innerRadius: number, startDegrees = -90): string {
  const points = Array.from({ length: 10 }, (_, i) =>
    polarPoint(cx, cy, i % 2 === 0 ? outerRadius : innerRadius, startDegrees + i * 36),
  );
  return `M${points.join(" L")} Z`;
}

const COMPASS_STAR_PATH = starPolygonPath(50, 50, 43, 18, -90);

const CENTER_STAR_PATH =
  "M50 27 L56 43 L73 43 L59 53 L64 70 L50 60 L36 70 L41 53 L27 43 L44 43 Z";

const SPARKLE_PATH = "M0 -12 L3.4 -3.4 L12 0 L3.4 3.4 L0 12 L-3.4 3.4 L-12 0 L-3.4 -3.4 Z";

/**
 * The medallion inside each base quadrant: a solid color disc, a broad
 * 5-corner white compass star, small accent stars, and a colored center seal
 * with a white star.
 */
export function CompassEmblem({
  color,
  className,
  x,
  y,
  width,
  height,
}: {
  color: PlayerColor;
  className?: string;
  /** Positions this as a nested SVG viewport — set when embedding directly inside a parent <svg> (e.g. BoardArtwork), instead of CSS sizing via `className` alone. */
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
}) {
  const classes = QUADRANT_CLASSES[color];
  return (
    <svg viewBox="0 0 100 100" x={x} y={y} width={width} height={height} className={className} aria-hidden>
      <defs>
        <filter id={`sparkle-glow-${color}`} x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx="50" cy="50" r="46" className={classes.text} fill="currentColor" />
      <path d={COMPASS_STAR_PATH} fill="white" />
      <circle cx="50" cy="50" r="17" className={classes.text} fill="currentColor" />
      <path d={CENTER_STAR_PATH} fill="white" transform="translate(50 50) scale(0.48) translate(-50 -50)" />
      {SPARKLE_POSITIONS.map(([cx, cy], i) => (
        <g
          key={i}
          transform={`translate(${cx} ${cy}) scale(0.55)`}
          fill="white"
          filter={`url(#sparkle-glow-${color})`}
          opacity="0.96"
        >
          <path d={SPARKLE_PATH} />
        </g>
      ))}
    </svg>
  );
}
