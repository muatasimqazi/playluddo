import { QUADRANT_CLASSES } from "@/components/shared/colors";
import type { PlayerColor } from "@/lib/board/types";

function polarXY(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

function polarPoint(cx: number, cy: number, radius: number, degrees: number): string {
  const [x, y] = polarXY(cx, cy, radius, degrees);
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

// The reference medallion (a clean, unambiguous screenshot supplied
// directly by the user) is a 5-point star reaching almost to the disc's
// edge, with a small same-color pentagram sitting directly on the white
// star where its points converge, and 5 white sparkle stars — one in each
// of the 5 notches between adjacent points, not 4 diagonal ones.
const COMPASS_POINTS = 5;
// The star's own rotation — shared by every piece that needs to stay
// aligned with it (the star itself, the sparkles sitting in its notches).
// SPARKLE_POSITIONS used to hardcode -90 independently of this, so
// rotating the star to -75 here without updating that too is exactly what
// threw the sparkles out of their notches.
const COMPASS_START_DEGREES = -75;
// Inner/outer ratio ~0.39 — same proportion as STAR_PATH above (already
// checked against the reference elsewhere on the board). Carried over the
// old 4-point kite's inner radius (9, a much thinner ~0.2 ratio) when this
// went from 4 points to 5 without re-tuning it, which is what made the
// star read as squished/distorted rather than a clean 5-point star.
const COMPASS_STAR_PATH = starPolygonPath(50, 50, 44, 15, COMPASS_POINTS, COMPASS_START_DEGREES);
const CENTER_STAR_PATH = starPolygonPath(50, 50, 16, 5, 5, COMPASS_START_DEGREES + 35);
// radius 16
const CENTER_CIRCLE_PATH = "M50,34 A16,16 0 1,0 50,66 A16,16 0 1,0 50,34 Z";
const SPARKLE_PATH = starPolygonPath(0, 0, 3.5, 1, 5, COMPASS_START_DEGREES);

// One sparkle per notch: the valley between star point i and point i+1
// sits exactly halfway between their two angles (points are 360/5 apart,
// starting at COMPASS_START_DEGREES — the same rotation the star itself
// uses, so the two can't drift apart again).
const SPARKLE_POSITIONS: readonly (readonly [number, number])[] = Array.from(
  { length: COMPASS_POINTS },
  (_, i) =>
    polarXY(
      50,
      50,
      29,
      COMPASS_START_DEGREES + 360 / COMPASS_POINTS / 2 + (i * 360) / COMPASS_POINTS,
    ),
);

/**
 * The medallion inside each base quadrant: a solid color disc, a white
 * 5-point star reaching toward its edge, a small same-color pentagram
 * where the star's points converge, and 5 small white sparkle stars, one
 * in each notch between adjacent points.
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
      <path d={CENTER_CIRCLE_PATH} className={classes.text} fill="currentColor" />
      <path d={CENTER_STAR_PATH} className={classes.text} fill="white" />
      {SPARKLE_POSITIONS.map(([cx, cy], i) => (
        <path key={i} d={SPARKLE_PATH} transform={`translate(${cx} ${cy})`} fill="white" />
      ))}
    </svg>
  );
}
