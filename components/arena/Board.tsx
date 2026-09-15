"use client";

import type { Ref } from "react";
import { PATH_INDEX, pathIndexToGlobalCell } from "@/lib/board/geometry";
import type { GameRoomState, Pawn, PlayerColor } from "@/lib/board/types";
import {
  BASE_AREA,
  GRID_SIZE,
  HOME_LANE_CELLS,
  globalCellToGridPosition,
} from "./boardLayout";
import { BoardArtwork } from "./BoardArtwork";

interface BoardProps {
  roomState: GameRoomState;
  legalPawnIds: ReadonlySet<string>;
  onSelectPawn: (pawnId: string) => void;
  /**
   * The board's own root element — at lg+ its width is no longer a static
   * Tailwind breakpoint (it's height-driven, see the className below), so
   * the caller can't know it ahead of time. MatchArena measures this ref
   * with a ResizeObserver to keep the status-pod rows the same width as
   * whatever the board actually renders at.
   */
  boardRef?: Ref<HTMLDivElement>;
}

export function Board({ roomState, legalPawnIds, onSelectPawn, boardRef }: BoardProps) {
  const trackPawnsByCell = new Map<number, Pawn[]>();
  const nestPawnsByColor = new Map<PlayerColor, Pawn[]>();
  // Keyed by `${color}-${homeIndex}` (homeIndex 0-4, one of HOME_LANE_CELLS'
  // 5 cells for that color) — a pawn's pathIndex maps to exactly one
  // homeIndex the same way it maps to exactly one global track cell, and
  // same-color pawns can share a cell here too (no-blockade rule applies
  // in the home lane the same as the shared track), so this stacks the
  // same way trackPawnsByCell does.
  const homeLanePawnsByKey = new Map<string, Pawn[]>();
  // Order-stable (roomState.pawns' own order, i.e. by pawn.index) so a
  // given pawn keeps the same finish slot as more of its color finish —
  // same pattern NEST_SLOT_POSITIONS below already uses for nest pawns.
  const finishedPawnsByColor = new Map<PlayerColor, Pawn[]>();

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
    } else if (pawn.state === "home_lane" && pawn.pathIndex !== null) {
      const key = `${pawn.color}-${pawn.pathIndex - PATH_INDEX.HOME_LANE_START}`;
      const list = homeLanePawnsByKey.get(key) ?? [];
      list.push(pawn);
      homeLanePawnsByKey.set(key, list);
    } else if (pawn.state === "finished") {
      const list = finishedPawnsByColor.get(pawn.color) ?? [];
      list.push(pawn);
      finishedPawnsByColor.set(pawn.color, list);
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

  const homeLaneCells = (Object.keys(HOME_LANE_CELLS) as PlayerColor[]).flatMap((color) =>
    HOME_LANE_CELLS[color].map(([row, col], homeIndex) => {
      const pawnsHere = homeLanePawnsByKey.get(`${color}-${homeIndex}`) ?? [];
      return (
        <div
          key={`home-${color}-${homeIndex}`}
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
        </div>
      );
    }),
  );

  return (
    <div
      ref={boardRef}
      className="mx-auto w-full max-w-115 border border-outline/55 bg-surface p-2 shadow-elevation-2 sm:max-w-135 sm:p-4 md:max-w-160 lg:h-full lg:w-auto lg:max-w-full"
    >
      <div
        data-board-grid
        className="relative grid aspect-square w-full max-w-full lg:h-full lg:w-auto overflow-hidden bg-surface"
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
        {homeLaneCells}

        {(Object.keys(FINISH_SLOT_POSITIONS) as PlayerColor[]).map((color) => (
          <FinishedPawnCluster key={color} color={color} pawns={finishedPawnsByColor.get(color) ?? []} />
        ))}
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

// The 4 "home pile" slots per color, inside that color's own center
// pinwheel wedge — pawns in the "finished" state (pathIndex 56) were
// computed but never actually rendered anywhere before, so a pawn that
// completed the board just vanished. Two rows of two, straddling that
// wedge's own star badge (CENTER_WEDGES in BoardArtwork.tsx) — some
// visual overlap with the star is expected/fine (real Ludo boards pile
// finished pawns right on top of the home decoration), spaced roughly a
// pawn-diameter apart so up to 4 in the same wedge don't overlap each
// other. Board-grid units (0-15), same space as everything else on this
// board, not percentages — converted in FinishedPawnCluster below.
const FINISH_SLOT_POSITIONS: Record<PlayerColor, readonly (readonly [number, number])[]> = {
  green: [
    [7.1, 6.95],
    [7.9, 6.95],
    [7.1, 6.35],
    [7.9, 6.35],
  ],
  yellow: [
    [8.05, 7.1],
    [8.05, 7.9],
    [8.65, 7.1],
    [8.65, 7.9],
  ],
  blue: [
    [7.1, 8.05],
    [7.9, 8.05],
    [7.1, 8.65],
    [7.9, 8.65],
  ],
  red: [
    [6.95, 7.1],
    [6.95, 7.9],
    [6.35, 7.1],
    [6.35, 7.9],
  ],
};

// Absolutely positioned (not a grid item, unlike track/home-lane cells) —
// FINISH_SLOT_POSITIONS' coordinates don't land on integer grid lines, so
// this converts them to percentages of the whole board instead of using
// gridRow/gridColumn placement.
function FinishedPawnCluster({ color, pawns }: { color: PlayerColor; pawns: Pawn[] }) {
  return (
    <>
      {FINISH_SLOT_POSITIONS[color].map(([col, row], i) => {
        const pawn = pawns[i];
        if (!pawn) return null;
        return (
          <div
            key={pawn.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${(col / GRID_SIZE) * 100}%`,
              top: `${(row / GRID_SIZE) * 100}%`,
              width: `${((1 / GRID_SIZE) * 100 * 0.78).toFixed(3)}%`,
              height: `${((1 / GRID_SIZE) * 100 * 0.78).toFixed(3)}%`,
              zIndex: 5,
            }}
          >
            <PawnToken color={color} isLegal={false} onClick={onSelectPawnNoop} variant="track" />
          </div>
        );
      })}
    </>
  );
}

// Finished pawns are never a legal move target (PRD/rules.test.ts: "finished
// pawns never appear in legal moves again"), so PawnToken's button is always
// disabled here regardless — this exists only because PawnToken's onClick
// prop is required, not because it can ever actually fire.
function onSelectPawnNoop() {}

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
