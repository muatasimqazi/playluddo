import { QUADRANT_CLASSES } from "@/components/shared/colors";
import type { PlayerColor } from "@/lib/board/types";

function polarPoint(cx: number, cy: number, radius: number, degrees: number): string {
  const radians = (degrees * Math.PI) / 180;
  const x = cx + radius * Math.cos(radians);
  const y = cy + radius * Math.sin(radians);
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

function starPolygonPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  points: number,
  startDegrees = -90,
): string {
  const step = 360 / points;
  const vertices = Array.from({ length: points * 2 }, (_, i) =>
    polarPoint(cx, cy, i % 2 === 0 ? outerRadius : innerRadius, startDegrees + (i * step) / 2),
  );
  return `M${vertices.join(" L")} Z`;
}

// A crisp 5-point star (outer/inner ratio ~0.39, points reaching almost to
// the edge of its own 24x24 box) — matches designs/board-design.png's star
// exactly where it was checked pixel-by-pixel (a plain white circle, no
// border ring, with the star's points nearly touching the circle's edge).
// Replaces an earlier Heroicons-style outline star, which has rounded/
// beveled points and a much larger inner radius — a visibly softer,
// smaller-looking star than the reference actually uses.
export const STAR_PATH = starPolygonPath(12, 12, 11.3, 4.4, 5, -90);

/**
 * The circular star badge used all over designs/board-design.png — parking
 * spots, the home-lane run, and the safe-cell markers on the shared track
 * all reuse this exact motif (a plain circle, no border, with a colored or
 * white star sized to nearly fill it). One shared component keeps every use
 * pixel-consistent instead of redrawing the star per call site.
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
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${filled ? classes.tint : "bg-white"}`}
      style={{ width: size, height: size }}
    >
      <StarIcon className={classes.text} size="88%" />
    </span>
  );
}

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

// The reference medallion (a high-resolution crop of the design's red
// quadrant, supplied directly by the user) is a 4-point compass kite — not
// a 5-point star — reaching almost to the disc's edge, with a small
// same-color pentagram sitting directly on the white kite where its points
// converge, and exactly 4 white sparkle stars in the diagonal notches
// between the kite's arms. Confirmed against that crop point-by-point, not
// approximated from the lower-fidelity full-board screenshot.
const COMPASS_STAR_PATH = starPolygonPath(50, 50, 44, 9, 4, -90);
const CENTER_STAR_PATH = starPolygonPath(50, 50, 11, 4.3, 5, -90);
const SPARKLE_PATH = starPolygonPath(0, 0, 6, 1.8, 4, -90);

// Diagonal notch positions (NE/SE/SW/NW) between the kite's 4 arms.
const SPARKLE_POSITIONS: readonly (readonly [number, number])[] = [
  [70.5, 29.5],
  [70.5, 70.5],
  [29.5, 70.5],
  [29.5, 29.5],
];

/**
 * The medallion inside each base quadrant: a solid color disc, a white
 * 4-point compass kite reaching toward its edge, a small same-color
 * pentagram where the kite's points converge, and 4 small white sparkle
 * stars in the diagonal notches between them.
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
      <circle cx="50" cy="50" r="46" className={classes.text} fill="currentColor" />
      <path d={COMPASS_STAR_PATH} fill="white" />
      <path d={CENTER_STAR_PATH} className={classes.text} fill="currentColor" />
      {SPARKLE_POSITIONS.map(([cx, cy], i) => (
        <path key={i} d={SPARKLE_PATH} transform={`translate(${cx} ${cy})`} fill="white" />
      ))}
    </svg>
  );
}
