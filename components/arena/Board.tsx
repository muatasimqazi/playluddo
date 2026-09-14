"use client";

import { QUADRANT_CLASSES, QUADRANT_INITIAL } from "@/components/shared/colors";
import { SAFE_CELLS, pathIndexToGlobalCell } from "@/lib/board/geometry";
import type { GameRoomState, Pawn, PlayerColor } from "@/lib/board/types";
import {
  BASE_AREA,
  CENTER_AREA,
  CORNER_CELLS,
  GRID_SIZE,
  HOME_LANE_CELLS,
  NEST_AREA,
  globalCellToGridPosition,
} from "./boardLayout";

interface BoardProps {
  roomState: GameRoomState;
  legalPawnIds: ReadonlySet<string>;
  onSelectPawn: (pawnId: string) => void;
}

// DESIGN.md: "Home runs: tinted 12% opacity ... leading to the central
// triumph triangle." The center pinwheel wedges follow the same
// top/right/bottom/left placement as each color's home-lane arm.
const CENTER_WEDGE_ORDER: readonly PlayerColor[] = ["green", "yellow", "blue", "red"];

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
        className={`flex items-center justify-center border border-hairline ${isSafe ? "bg-[#F3F4F6]" : "bg-surface"}`}
        style={{ gridRow: row + 1, gridColumn: col + 1, zIndex: 2 }}
      >
        {isSafe && pawnsHere.length === 0 && (
          <span aria-hidden className="text-[10px] text-[#9CA3AF]">
            ★
          </span>
        )}
        <div className="flex items-center justify-center">
          {pawnsHere.map((pawn, i) => (
            <div key={pawn.id} className={i > 0 ? "-ml-1.5" : ""} style={{ zIndex: i }}>
              <PawnToken color={pawn.color} isLegal={legalPawnIds.has(pawn.id)} onClick={() => onSelectPawn(pawn.id)} />
            </div>
          ))}
        </div>
      </div>,
    );
  }

  return (
    <div
      className="relative mx-auto grid aspect-square w-full max-w-[520px] gap-px rounded-lg border border-hairline bg-hairline p-1"
      style={{
        gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
        gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
      }}
    >
      {(Object.keys(BASE_AREA) as PlayerColor[]).map((color) => (
        <BaseQuadrant key={color} color={color} />
      ))}

      {/* Central triumph triangle: a pinwheel of the 4 quadrant colors,
          spanning the 3x3 center. The 4 diagonal corner cells (real,
          addressable-in-render-only track bridges — see boardLayout.ts)
          are drawn afterward, above this, so they read as distinct cells. */}
      <div
        aria-hidden
        className="rounded-[3px]"
        style={{
          gridRow: `${CENTER_AREA.rowStart + 1} / span ${CENTER_AREA.rowEnd - CENTER_AREA.rowStart + 1}`,
          gridColumn: `${CENTER_AREA.colStart + 1} / span ${CENTER_AREA.colEnd - CENTER_AREA.colStart + 1}`,
          zIndex: 1,
          background: `conic-gradient(from -45deg, ${CENTER_WEDGE_ORDER.map(
            (color, i) => `var(--quadrant-${color}) ${i * 90}deg ${(i + 1) * 90}deg`,
          ).join(", ")})`,
        }}
      />

      {(Object.keys(HOME_LANE_CELLS) as PlayerColor[]).flatMap((color) =>
        HOME_LANE_CELLS[color].map(([row, col], i) => (
          <div
            key={`home-${color}-${i}`}
            aria-hidden
            className={`border border-hairline ${QUADRANT_CLASSES[color].tint}`}
            style={{ gridRow: row + 1, gridColumn: col + 1, zIndex: 1 }}
          />
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

      {(Object.keys(NEST_AREA) as PlayerColor[]).map((color) => (
        <NestArea
          key={color}
          color={color}
          pawns={nestPawnsByColor.get(color) ?? []}
          legalPawnIds={legalPawnIds}
          onSelectPawn={onSelectPawn}
        />
      ))}
    </div>
  );
}

// DESIGN.md quadrant blocks: a large solid-tinted base square per player,
// with a bordered emblem area (NestArea, drawn separately) inset within it.
function BaseQuadrant({ color }: { color: PlayerColor }) {
  const area = BASE_AREA[color];
  const classes = QUADRANT_CLASSES[color];
  return (
    <div
      aria-hidden
      className={`rounded-md border ${classes.border} ${classes.tint}`}
      style={{
        gridRow: `${area.rowStart + 1} / span ${area.rowEnd - area.rowStart + 1}`,
        gridColumn: `${area.colStart + 1} / span ${area.colEnd - area.colStart + 1}`,
        zIndex: 0,
      }}
    />
  );
}

function NestArea({
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
  const area = NEST_AREA[color];
  const classes = QUADRANT_CLASSES[color];

  return (
    <div
      className={`flex flex-wrap content-center items-center justify-center gap-1.5 rounded-md border ${classes.border} bg-surface p-2 shadow-elevation-1`}
      style={{
        gridRow: `${area.rowStart + 1} / span ${area.rowEnd - area.rowStart + 1}`,
        gridColumn: `${area.colStart + 1} / span ${area.colEnd - area.colStart + 1}`,
        zIndex: 3,
      }}
    >
      {pawns.length === 0 ? (
        <span className={`text-xs font-semibold ${classes.text}`} aria-hidden>
          {QUADRANT_INITIAL[color]}
        </span>
      ) : (
        pawns.map((pawn) => (
          <PawnToken
            key={pawn.id}
            color={color}
            isLegal={legalPawnIds.has(pawn.id)}
            onClick={() => onSelectPawn(pawn.id)}
          />
        ))
      )}
    </div>
  );
}

// DESIGN.md "Ceramic Disk Tokens": solid quadrant fill, 1.5pt white
// perimeter ring, an inner engraved circle motif, and a grounded contact
// shadow with an inset highlight (elevation level 3).
function PawnToken({
  color,
  isLegal,
  onClick,
}: {
  color: PlayerColor;
  isLegal: boolean;
  onClick: () => void;
}) {
  const classes = QUADRANT_CLASSES[color];
  return (
    <button
      type="button"
      onClick={isLegal ? onClick : undefined}
      disabled={!isLegal}
      aria-label={`${color} pawn${isLegal ? " — legal move, tap to select" : ""}`}
      className={`relative h-[18px] w-[18px] shrink-0 rounded-full border-[1.5px] border-white shadow-elevation-3 ${classes.bg} ${
        isLegal ? "cursor-pointer ring-2 ring-action ring-offset-1" : ""
      }`}
    >
      {/* Inner engraved-ceramic motif. */}
      <span className="absolute inset-0.75 rounded-full border border-white/40" aria-hidden />
      {/* Non-color identity per PRD 7.2: the initial doubles as a symbol distinct from color alone. */}
      <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-white" aria-hidden>
        {QUADRANT_INITIAL[color]}
      </span>
    </button>
  );
}
