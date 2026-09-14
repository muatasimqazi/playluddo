import { CompassEmblem, StarIcon } from "@/components/shared/StarBadge";
import { SAFE_CELLS } from "@/lib/board/geometry";
import type { PlayerColor } from "@/lib/board/types";
import {
  BASE_AREA,
  CORNER_CELLS,
  HOME_LANE_CELLS,
  armColorForCell,
  globalCellToGridPosition,
} from "./boardLayout";
import { NEST_SLOT_POSITIONS } from "./boardArtworkGeometry";

const COLORS: readonly PlayerColor[] = ["red", "green", "yellow", "blue"];

const HAIRLINE_STROKE = 0.025;

function quadrant(color: PlayerColor, suffix?: "tint" | "border"): string {
  return `var(--quadrant-${color}${suffix ? `-${suffix}` : ""})`;
}

// Center pinwheel wedges, top/right/bottom/left, colored to match the home
// lane running through that side (green/yellow/blue/red — see
// boardLayout.ts's armColorForCell doc). Spans the 3x3 CENTER_AREA (x/y
// 6-9), apex at the true center (7.5, 7.5).
const CENTER_WEDGES: readonly { color: PlayerColor; points: string; starAt: readonly [number, number] }[] = [
  { color: "green", points: "6,6 9,6 7.5,7.5", starAt: [7.5, 6.6] },
  { color: "yellow", points: "9,6 9,9 7.5,7.5", starAt: [8.4, 7.5] },
  { color: "blue", points: "9,9 6,9 7.5,7.5", starAt: [7.5, 8.4] },
  { color: "red", points: "6,9 6,6 7.5,7.5", starAt: [6.6, 7.5] },
];

/**
 * The board texture as real vector SVG — every cell, badge and wedge is its
 * own element in the 0-15 (one unit per grid cell) coordinate space, so any
 * of it can later become a `motion.*` element without redrawing anything.
 * Replaces an earlier version of this component that just displayed a
 * screenshot of the reference mockup via <image>, which is exactly the kind
 * of thing that can't be animated piece-by-piece.
 */
export function BoardArtwork() {
  return (
    <svg viewBox="0 0 15 15" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {COLORS.map((color) => (
        <BaseQuadrantArt key={color} color={color} />
      ))}

      <g>
        {CENTER_WEDGES.map(({ color, points }) => (
          <polygon key={color} points={points} style={{ fill: quadrant(color) }} />
        ))}
        {CENTER_WEDGES.map(({ color, starAt: [cx, cy] }) => (
          <StarIcon key={color} x={cx - 0.22} y={cy - 0.22} width={0.44} height={0.44} fill="white" />
        ))}
      </g>

      {COLORS.flatMap((color) =>
        HOME_LANE_CELLS[color].map(([row, col], i) => (
          <g key={`home-${color}-${i}`}>
            <rect
              x={col}
              y={row}
              width={1}
              height={1}
              fill="white"
              style={{ stroke: "var(--hairline)", strokeWidth: HAIRLINE_STROKE }}
            />
            <CellStarBadge color={color} cx={col + 0.5} cy={row + 0.5} r={0.36} />
          </g>
        )),
      )}

      {Array.from({ length: 52 }, (_, index) => {
        const { row, col } = globalCellToGridPosition(index);
        const isSafe = SAFE_CELLS.has(index);
        return (
          <g key={index}>
            <rect
              x={col}
              y={row}
              width={1}
              height={1}
              fill="white"
              style={{ stroke: "var(--hairline)", strokeWidth: HAIRLINE_STROKE }}
            />
            {isSafe && <CellStarBadge color={armColorForCell(row, col)} cx={col + 0.5} cy={row + 0.5} r={0.28} />}
          </g>
        );
      })}

      {CORNER_CELLS.map(([row, col], i) => (
        <rect
          key={i}
          x={col}
          y={row}
          width={1}
          height={1}
          fill="white"
          style={{ stroke: "var(--hairline)", strokeWidth: HAIRLINE_STROKE }}
        />
      ))}
    </svg>
  );
}

// A solid-color disc with a white star glyph — the marker used for both the
// dense home-lane run and the 8 real SAFE_CELLS on the shared track (sized
// differently by the caller), matching the reference's star-on-color-disc
// motif for on-track markers.
function CellStarBadge({ color, cx, cy, r }: { color: PlayerColor; cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} style={{ fill: quadrant(color) }} />
      <StarIcon x={cx - r * 0.64} y={cy - r * 0.64} width={r * 1.28} height={r * 1.28} fill="white" />
    </g>
  );
}

function BaseQuadrantArt({ color }: { color: PlayerColor }) {
  const area = BASE_AREA[color];
  const x = area.colStart;
  const y = area.rowStart;
  const size = area.colEnd - area.colStart + 1; // 6 cells
  const panelInset = size * 0.24;
  const panelSize = size - panelInset * 2;
  const emblemInset = panelSize * 0.14;

  return (
    <g>
      <rect x={x} y={y} width={size} height={size} style={{ fill: quadrant(color) }} />
      <rect x={x + panelInset} y={y + panelInset} width={panelSize} height={panelSize} rx={size * 0.04} fill="white" />
      <CompassEmblem
        color={color}
        x={x + panelInset + emblemInset}
        y={y + panelInset + emblemInset}
        width={panelSize - emblemInset * 2}
        height={panelSize - emblemInset * 2}
      />
      {NEST_SLOT_POSITIONS[color].map(([leftPct, topPct], i) => (
        <NestBadge key={i} color={color} cx={x + (leftPct / 100) * size} cy={y + (topPct / 100) * size} r={size * 0.075} />
      ))}
    </g>
  );
}

// A white disc with a colored star — the pawn-parking marker at each base's
// 4 corners, distinct from CellStarBadge's solid-disc treatment because the
// reference draws these two motifs differently (confirmed from a
// high-resolution crop the user supplied of the red quadrant specifically).
function NestBadge({ color, cx, cy, r }: { color: PlayerColor; cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="white" style={{ stroke: quadrant(color, "border"), strokeWidth: r * 0.14 }} />
      <StarIcon x={cx - r * 0.62} y={cy - r * 0.62} width={r * 1.24} height={r * 1.24} fill={quadrant(color)} />
    </g>
  );
}
