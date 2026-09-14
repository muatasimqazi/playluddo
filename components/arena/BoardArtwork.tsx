import { CompassEmblem, StarIcon } from "@/components/shared/StarBadge";
import { SAFE_CELLS } from "@/lib/board/geometry";
import type { PlayerColor } from "@/lib/board/types";
import { BASE_AREA, HOME_LANE_CELLS, armColorForCell, globalCellToGridPosition } from "./boardLayout";
import { NEST_SLOT_POSITIONS } from "./boardArtworkGeometry";

const COLORS: readonly PlayerColor[] = ["red", "green", "yellow", "blue"];

const HAIRLINE_STROKE = 0.025;

// Shared by every star badge on the board — home lane, the 8 real
// SAFE_CELLS, and the center wedges — so they all read as the same motif
// at the same size, per direct instruction.
const CELL_STAR_RADIUS = 0.44;

function quadrant(color: PlayerColor, suffix?: "tint" | "border"): string {
  return `var(--quadrant-${color}${suffix ? `-${suffix}` : ""})`;
}

// Center pinwheel wedges, top/right/bottom/left, colored to match the home
// lane running through that side (green/yellow/blue/red — see
// boardLayout.ts's armColorForCell doc). Spans the 3x3 CENTER_AREA (x/y
// 6-9), apex at the true center (7.5, 7.5).
const CENTER_WEDGES: readonly { color: PlayerColor; points: string; starAt: readonly [number, number] }[] = [
  { color: "green", points: "6,6 9,6 7.5,7.5", starAt: [7.5, 6.62] },
  { color: "yellow", points: "9,6 9,9 7.5,7.5", starAt: [8.38, 7.5] },
  { color: "blue", points: "9,9 6,9 7.5,7.5", starAt: [7.5, 8.38] },
  { color: "red", points: "6,9 6,6 7.5,7.5", starAt: [6.62, 7.5] },
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
          <NestBadge key={color} color={color} cx={cx} cy={cy} r={CELL_STAR_RADIUS} />
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
              style={{ fill: quadrant(color), stroke: "var(--hairline)", strokeWidth: HAIRLINE_STROKE }}
            />
            <NestBadge color={color} cx={col + 0.5} cy={row + 0.5} r={CELL_STAR_RADIUS} />
          </g>
        )),
      )}

      {Array.from({ length: 52 }, (_, index) => {
        const { row, col } = globalCellToGridPosition(index);
        const safeColor = SAFE_CELLS.has(index) ? armColorForCell(row, col) : null;
        return (
          <g key={index}>
            <rect
              x={col}
              y={row}
              width={1}
              height={1}
              style={{
                fill: safeColor ? quadrant(safeColor) : "white",
                stroke: "var(--hairline)",
                strokeWidth: HAIRLINE_STROKE,
              }}
            />
            {safeColor && <NestBadge color={safeColor} cx={col + 0.5} cy={row + 0.5} r={CELL_STAR_RADIUS} />}
          </g>
        );
      })}

      <ArmDecorations />
    </svg>
  );
}

// 3 decorative arrows per arm — a curved "entry flow" arrow near the top of
// the near-base column, a straight "advance" arrow partway down the far
// column, and a short diagonal arrow at the arm-to-center corner — matching
// the density the reference board actually has beyond its star badges.
// Drawn once for the top arm in absolute grid coordinates, then rotated
// 90/180/270° around the board's true center for the other 3 arms — the
// same 4-fold rotation the rest of the board's geometry (CENTER_WEDGES,
// HOME_LANE_CELLS, armColorForCell) already relies on, so no separate
// per-arm coordinates to keep in sync. (This used to also draw an "extra"
// star at this same spot — that cell turned out to be a real SAFE_CELLS
// position (index 3 of the top arm) once pixel-checked against
// designs/board-design.png, so it's now drawn once, correctly, by the main
// SAFE_CELLS loop above instead of a second time here.)
const ARM_ROTATIONS: readonly { angle: number; color: PlayerColor }[] = [
  { angle: 0, color: "green" },
  { angle: 90, color: "yellow" },
  { angle: 180, color: "blue" },
  { angle: 270, color: "red" },
];

function ArmDecorations() {
  return (
    <>
      <defs>
        {ARM_ROTATIONS.map(({ color }) => (
          <g key={color}>
            {/* Bold triangular head, per the user-supplied reference shape. */}
            <marker
              id={`arrowhead-${color}`}
              viewBox="0 0 12 12"
              refX="10"
              refY="6"
              markerWidth="4.4"
              markerHeight="4.4"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L11,6 L0,11 Z" style={{ fill: quadrant(color) }} />
            </marker>
            {/* 3-chevron fletching at the tail, per the same reference. */}
            <marker
              id={`arrowtail-${color}`}
              viewBox="0 0 12 12"
              refX="9"
              refY="6"
              markerWidth="5.4"
              markerHeight="5.4"
              orient="auto-start-reverse"
            >
              <path
                d="M9,2 L6,6 L9,10 M6.5,2 L3.5,6 L6.5,10 M4,2 L1,6 L4,10"
                fill="none"
                style={{ stroke: quadrant(color) }}
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </marker>
          </g>
        ))}
      </defs>
      {ARM_ROTATIONS.map(({ angle, color }) => (
        <g key={angle} transform={`rotate(${angle} 7.5 7.5)`}>
          <path
            d="M6.35 1.75 Q6.55 0.55 7.3 0.65"
            fill="none"
            style={{ stroke: quadrant(color), strokeWidth: 0.06 }}
            markerStart={`url(#arrowtail-${color})`}
            markerEnd={`url(#arrowhead-${color})`}
          />
          <line
            x1={8.5}
            y1={2.15}
            x2={8.5}
            y2={3.4}
            style={{ stroke: quadrant(color), strokeWidth: 0.06 }}
            markerStart={`url(#arrowtail-${color})`}
            markerEnd={`url(#arrowhead-${color})`}
          />
          {/* Middle of cell 12 to middle of cell 13 — the arm-to-arm
              handoff at this corner (rotated per arm: 25→26, 38→39, 51→0). */}
          <line
            x1={8.5}
            y1={5.5}
            x2={9.5}
            y2={6.5}
            style={{ stroke: quadrant(color), strokeWidth: 0.06 }}
            markerStart={`url(#arrowtail-${color})`}
            markerEnd={`url(#arrowhead-${color})`}
          />
        </g>
      ))}
    </>
  );
}

function BaseQuadrantArt({ color }: { color: PlayerColor }) {
  const area = BASE_AREA[color];
  const x = area.colStart;
  const y = area.rowStart;
  const size = area.colEnd - area.colStart + 1; // 6 cells
  // Inset exactly 1 grid unit from the base's own edge on every side, sharp
  // corners (no radius) — per direct instruction.
  const panelInset = 1;
  const panelSize = size - panelInset * 2;
  const emblemInset = panelSize * 0.14;

  return (
    <g>
      <rect x={x} y={y} width={size} height={size} style={{ fill: quadrant(color) }} />
      <rect x={x + panelInset} y={y + panelInset} width={panelSize} height={panelSize} fill="white" />
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
// reference draws these two motifs differently. A plain circle with no
// border ring, and the star sized to nearly fill it — confirmed by pixel-
// sampling designs/board-design.png directly, not approximated.
function NestBadge({ color, cx, cy, r }: { color: PlayerColor; cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="white" />
      <StarIcon x={cx - r * 0.935} y={cy - r * 0.935} width={r * 1.87} height={r * 1.87} fill={quadrant(color)} />
    </g>
  );
}
