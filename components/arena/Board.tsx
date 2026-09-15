"use client";

import { pathIndexToGlobalCell } from "@/lib/board/geometry";
import type { GameRoomState, Pawn, PlayerColor } from "@/lib/board/types";
import {
  BASE_AREA,
  GRID_SIZE,
  globalCellToGridPosition,
} from "./boardLayout";
import { BoardArtwork } from "./BoardArtwork";

interface BoardProps {
  roomState: GameRoomState;
  legalPawnIds: ReadonlySet<string>;
  onSelectPawn: (pawnId: string) => void;
}

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
    const pawnsHere = trackPawnsByCell.get(i) ?? [];
    cells.push(
      <div
        key={`cell-${i}`}
        className="flex items-center justify-center"
        style={{ gridRow: row + 1, gridColumn: col + 1, zIndex: 4 }}
      >
        <div className="flex h-full w-full items-center justify-center">
          {pawnsHere.map((pawn, i) => (
            <div
              key={pawn.id}
              className={`relative flex h-[78%] w-[78%] items-center justify-center ${
                i > 0 ? "-ml-[46%]" : ""
              }`}
              style={{ zIndex: i }}
            >
              <PawnToken
                color={pawn.color}
                isLegal={legalPawnIds.has(pawn.id)}
                onClick={() => onSelectPawn(pawn.id)}
                variant="track"
              />
            </div>
          ))}
        </div>
      </div>,
    );
  }

  return (
    <div className="mx-auto w-full max-w-115 border border-outline/55 bg-surface p-2 shadow-elevation-2 sm:max-w-135 sm:p-4 md:max-w-160 lg:max-w-200 xl:max-w-240">
      <div
        data-board-grid
        className="relative grid aspect-square w-full overflow-hidden bg-surface"
        style={{
          gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
          gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
        }}
      >
        <BoardArtwork />

        {(Object.keys(BASE_AREA) as PlayerColor[]).map((color) => (
          <BaseQuadrantHitArea
            key={color}
            color={color}
            pawns={nestPawnsByColor.get(color) ?? []}
            legalPawnIds={legalPawnIds}
            onSelectPawn={onSelectPawn}
          />
        ))}

        {cells}
      </div>
    </div>
  );
}

// The 4 parking-spot positions, fixed relative to each base quadrant's own
// box (independent of color) — close to the true corners, matching the
// reference's corner-parked pawns-on-star-badges.
const NEST_SLOT_POSITIONS: Record<PlayerColor, readonly (readonly [number, number])[]> = {
  red: [
    [10.52, 10.726],
    [89.728, 10.726],
    [11.345, 88.903],
    [89.315, 88.903],
  ],
  green: [
    [9.86, 10.932],
    [88.243, 11.345],
    [10.685, 88.903],
    [88.243, 88.903],
  ],
  yellow: [
    [10.479, 10.479],
    [88.861, 9.86],
    [10.685, 88.243],
    [88.243, 88.243],
  ],
  blue: [
    [10.52, 9.86],
    [89.109, 10.479],
    [11.345, 88.243],
    [89.728, 88.655],
  ],
};

// Transparent hit areas aligned over the printed nest slots in the board
// texture. The artwork supplies the visible star badges; this layer only
// preserves interactivity.
function BaseQuadrantHitArea({
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

  return (
    <div
      className="relative"
      style={{
        gridRow: `${area.rowStart + 1} / span ${area.rowEnd - area.rowStart + 1}`,
        gridColumn: `${area.colStart + 1} / span ${area.colEnd - area.colStart + 1}`,
        zIndex: 3,
      }}
    >
      {NEST_SLOT_POSITIONS[color].map(([left, top], i) => {
        const pawn = pawns[i];
        return (
          <div
            key={i}
            data-nest-slot={`${color}-${i}`}
            className="absolute flex h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            <NestSlot
              color={color}
              pawn={pawn}
              isLegal={pawn ? legalPawnIds.has(pawn.id) : false}
              onSelectPawn={onSelectPawn}
            />
          </div>
        );
      })}
    </div>
  );
}

function NestSlot({
  color,
  pawn,
  isLegal,
  onSelectPawn,
}: {
  color: PlayerColor;
  pawn: Pawn | undefined;
  isLegal: boolean;
  onSelectPawn: (pawnId: string) => void;
}) {
  if (!pawn) {
    return (
      <div className="relative flex h-full w-full items-center justify-center" />
    );
  }

  return (
    <button
      type="button"
      onClick={isLegal ? () => onSelectPawn(pawn.id) : undefined}
      disabled={!isLegal}
      aria-label={`${color} pawn in nest${isLegal ? " — legal move, tap to select" : ""}`}
      className="relative flex h-full w-full items-center justify-center rounded-full"
    >
      <PieceFace color={color} isLegal={isLegal} variant="nest" />
    </button>
  );
}

// Translucent glass pawn tokens. A legal, tappable pawn pulses with the
// reference's turn-ring glow.
function PawnToken({
  color,
  isLegal,
  onClick,
  variant,
}: {
  color: PlayerColor;
  isLegal: boolean;
  onClick: () => void;
  variant: "track" | "nest";
}) {
  return (
    <button
      type="button"
      onClick={isLegal ? onClick : undefined}
      disabled={!isLegal}
      aria-label={`${color} pawn${isLegal ? " — legal move, tap to select" : ""}`}
      className="relative flex h-full w-full shrink-0 items-center justify-center rounded-full"
    >
      <PieceFace color={color} isLegal={isLegal} variant={variant} />
    </button>
  );
}

function PieceFace({
  color,
  isLegal,
  variant,
}: {
  color: PlayerColor;
  isLegal: boolean;
  variant: "track" | "nest";
}) {
  return (
    <span
      className={`ludo-piece ludo-piece-${color} ${
        variant === "nest" ? "ludo-piece-nest" : "ludo-piece-track"
      } ${isLegal ? "ludo-piece-legal" : ""}`}
      aria-hidden
    />
  );
}
