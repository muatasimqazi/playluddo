"use client";

import { QUADRANT_CLASSES, QUADRANT_INITIAL } from "@/components/shared/colors";
import { CompassEmblem, StarBadge, StarIcon } from "@/components/shared/StarBadge";
import { SAFE_CELLS, pathIndexToGlobalCell } from "@/lib/board/geometry";
import type { GameRoomState, Pawn, PlayerColor } from "@/lib/board/types";
import {
  BASE_AREA,
  CENTER_AREA,
  CORNER_CELLS,
  GRID_SIZE,
  HOME_LANE_CELLS,
  armColorForCell,
  globalCellToGridPosition,
} from "./boardLayout";

interface BoardProps {
  roomState: GameRoomState;
  legalPawnIds: ReadonlySet<string>;
  onSelectPawn: (pawnId: string) => void;
}

// Center pinwheel wedges, top/right/bottom/left — matches the color of the
// home-lane arm on that side (see boardLayout.ts's armColorForCell doc).
const CENTER_WEDGE_ORDER: readonly PlayerColor[] = [
  "green",
  "yellow",
  "blue",
  "red",
];

export function Board({ roomState, legalPawnIds, onSelectPawn }: BoardProps) {
  const trackPawnsByCell = new Map<number, Pawn[]>();
  const nestPawnsByColor = new Map<PlayerColor, Pawn[]>();

  for (const pawn of roomState.pawns) {
    if (pawn.state === "track" && pawn.pathIndex !== null) {
      const globalCell = pathIndexToGlobalCell(pawn.color, pawn.pathIndex);
      const list = trackPawnsByCell.get(globalCell) ?? [];
      list.push(pawn);
      trackPawnsByCell.set(globalCell, list);
    } else if (pawn.state === "nest") {
      const list = nestPawnsByColor.get(pawn.color) ?? [];
      list.push(pawn);
      nestPawnsByColor.set(pawn.color, list);
    }
  }

  const cells = [];
  for (let i = 0; i <= 51; i++) {
    const { row, col } = globalCellToGridPosition(i);
    const isSafe = SAFE_CELLS.has(i);
    const pawnsHere = trackPawnsByCell.get(i) ?? [];
    cells.push(
      <div
        key={`cell-${i}`}
        className="flex items-center justify-center border border-hairline bg-surface"
        style={{ gridRow: row + 1, gridColumn: col + 1, zIndex: 2 }}
      >
        {isSafe && pawnsHere.length === 0 && (
          <StarBadge color={armColorForCell(row, col)} size={14} />
        )}
        <div className="flex items-center justify-center">
          {pawnsHere.map((pawn, i) => (
            <div
              key={pawn.id}
              className={i > 0 ? "-ml-1.5" : ""}
              style={{ zIndex: i }}
            >
              <PawnToken
                color={pawn.color}
                isLegal={legalPawnIds.has(pawn.id)}
                onClick={() => onSelectPawn(pawn.id)}
              />
            </div>
          ))}
        </div>
      </div>,
    );
  }

  return (
    // DESIGN reference "Board Chassis": a white card housing a dark inner
    // bezel around the playing surface.
    <div className="mx-auto w-full max-w-115 rounded-3xl border border-hairline bg-surface p-2 shadow-elevation-2 sm:max-w-135 md:max-w-160 xl:max-w-190">
      <div
        className="relative grid aspect-square w-full gap-px overflow-hidden rounded-2xl border border-black/10 bg-[#2b2b2b] p-1"
        style={{
          gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
          gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
        }}
      >
        {(Object.keys(BASE_AREA) as PlayerColor[]).map((color) => (
          <BaseQuadrant
            key={color}
            color={color}
            pawns={nestPawnsByColor.get(color) ?? []}
            legalPawnIds={legalPawnIds}
            onSelectPawn={onSelectPawn}
          />
        ))}

        {/* Central triumph triangle: a pinwheel of the 4 quadrant colors,
          spanning the 3x3 center, with a star badge per wedge. The 4
          diagonal corner cells (real, rendered track bridges — see
          boardLayout.ts) are drawn afterward, above this. */}
        <div
          aria-hidden
          className="relative rounded-[3px]"
          style={{
            gridRow: `${CENTER_AREA.rowStart + 1} / span ${CENTER_AREA.rowEnd - CENTER_AREA.rowStart + 1}`,
            gridColumn: `${CENTER_AREA.colStart + 1} / span ${CENTER_AREA.colEnd - CENTER_AREA.colStart + 1}`,
            zIndex: 1,
            background: `conic-gradient(from -45deg, ${CENTER_WEDGE_ORDER.map(
              (color, i) =>
                `var(--quadrant-${color}) ${i * 90}deg ${(i + 1) * 90}deg`,
            ).join(", ")})`,
          }}
        >
          {(
            [
              ["green", "50%", "22%"],
              ["yellow", "78%", "50%"],
              ["blue", "50%", "78%"],
              ["red", "22%", "50%"],
            ] as const
          ).map(([color, left, top]) => (
            <span
              key={color}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 p-[3px]"
              style={{ left, top }}
            >
              <StarIcon className={QUADRANT_CLASSES[color].text} size={10} />
            </span>
          ))}
        </div>

        {(Object.keys(HOME_LANE_CELLS) as PlayerColor[]).flatMap((color) =>
          HOME_LANE_CELLS[color].map(([row, col], i) => (
            <div
              key={`home-${color}-${i}`}
              className="flex items-center justify-center border border-hairline bg-surface"
              style={{ gridRow: row + 1, gridColumn: col + 1, zIndex: 1 }}
            >
              <StarBadge color={color} size={16} filled />
            </div>
          )),
        )}

        {cells}

        {CORNER_CELLS.map(([row, col], i) => (
          <div
            key={`corner-${i}`}
            aria-hidden
            className="border border-hairline bg-surface"
            style={{ gridRow: row + 1, gridColumn: col + 1, zIndex: 2 }}
          />
        ))}
      </div>
    </div>
  );
}

// The 4 parking-spot positions, fixed relative to each base quadrant's own
// box (independent of color) — close to the true corners, matching the
// reference's corner-parked pawns-on-star-badges.
const NEST_SLOT_POSITIONS: readonly (readonly [number, number])[] = [
  [13, 13],
  [87, 13],
  [13, 87],
  [87, 87],
];

// DESIGN reference: each base is a solid quadrant-color block with a large
// medallion emblem (CompassEmblem, on its own white inset panel) behind 4
// individual parking slots (one per pawn), each slot marked with its own
// star badge.
function BaseQuadrant({
  color,
  pawns,
  legalPawnIds,
  onSelectPawn,
}: {
  color: PlayerColor;
  pawns: Pawn[];
  legalPawnIds: ReadonlySet<string>;
  onSelectPawn: (pawnId: string) => void;
}) {
  const area = BASE_AREA[color];
  const classes = QUADRANT_CLASSES[color];

  return (
    <div
      className={`relative flex items-center justify-center rounded-md border ${classes.border} ${classes.bg}`}
      style={{
        gridRow: `${area.rowStart + 1} / span ${area.rowEnd - area.rowStart + 1}`,
        gridColumn: `${area.colStart + 1} / span ${area.colEnd - area.colStart + 1}`,
        zIndex: 0,
      }}
    >
      {/* White inset panel + compass medallion */}
      <div className="absolute inset-[16%] rounded-xl bg-white" aria-hidden>
        <CompassEmblem color={color} className="h-full w-full p-[8%]" />
      </div>

      {NEST_SLOT_POSITIONS.map(([left, top], i) => {
        const pawn = pawns[i];
        return (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            {pawn ? (
              <PawnToken
                color={color}
                isLegal={legalPawnIds.has(pawn.id)}
                onClick={() => onSelectPawn(pawn.id)}
              />
            ) : (
              <StarBadge color={color} size={20} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Translucent glass pawn tokens (app/globals.css `.glass-token`/`.glass-*`),
// ported from the reference's exact CSS. A legal, tappable pawn pulses with
// the reference's turn-ring glow; the initial stays as a faint watermark so
// identity never depends on color alone (PRD 7.2) without fighting the glass
// look.
function PawnToken({
  color,
  isLegal,
  onClick,
}: {
  color: PlayerColor;
  isLegal: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={isLegal ? onClick : undefined}
      disabled={!isLegal}
      aria-label={`${color} pawn${isLegal ? " — legal move, tap to select" : ""}`}
      className={`glass-token relative flex h-5 w-5 shrink-0 items-center justify-center glass-${color} ${
        isLegal ? "is-legal token-turn-ring cursor-pointer" : ""
      }`}
    >
      <span
        className="relative z-[1] text-[7px] font-bold text-white/85"
        style={{ textShadow: "0 1px 1px rgba(0,0,0,0.35)" }}
        aria-hidden
      >
        {QUADRANT_INITIAL[color]}
      </span>
    </button>
  );
}
