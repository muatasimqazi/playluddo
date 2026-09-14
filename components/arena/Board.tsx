"use client";

import { QUADRANT_CLASSES, QUADRANT_INITIAL } from "@/components/shared/colors";
import { SAFE_CELLS, pathIndexToGlobalCell } from "@/lib/board/geometry";
import type { GameRoomState, Pawn, PlayerColor } from "@/lib/board/types";
import { GRID_SIZE, NEST_AREA, globalCellToGridPosition } from "./boardLayout";

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
    const isSafe = SAFE_CELLS.has(i);
    const pawnsHere = trackPawnsByCell.get(i) ?? [];
    cells.push(
      <div
        key={`cell-${i}`}
        className={`flex items-center justify-center border border-hairline ${isSafe ? "bg-gray-50" : "bg-surface"}`}
        style={{ gridRow: row + 1, gridColumn: col + 1 }}
      >
        {isSafe && pawnsHere.length === 0 && (
          <span aria-hidden className="text-[10px] text-text-muted">
            ★
          </span>
        )}
        <div className="flex flex-wrap items-center justify-center gap-0.5">
          {pawnsHere.map((pawn) => (
            <PawnToken
              key={pawn.id}
              color={pawn.color}
              isLegal={legalPawnIds.has(pawn.id)}
              onClick={() => onSelectPawn(pawn.id)}
            />
          ))}
        </div>
      </div>,
    );
  }

  return (
    <div
      className="mx-auto grid aspect-square w-full max-w-[520px] gap-px rounded-lg border border-hairline bg-hairline p-1"
      style={{
        gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
        gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
      }}
    >
      {cells}
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
      className={`flex flex-wrap content-center items-center justify-center gap-1.5 rounded-md border ${classes.border} ${classes.tint} p-2`}
      style={{
        gridRow: `${area.rowStart + 1} / span ${area.rowEnd - area.rowStart + 1}`,
        gridColumn: `${area.colStart + 1} / span ${area.colEnd - area.colStart + 1}`,
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
      className={`relative h-[18px] w-[18px] shrink-0 rounded-full border-2 border-white ${classes.bg} shadow-sm ${
        isLegal ? "cursor-pointer ring-2 ring-action ring-offset-1" : ""
      }`}
    >
      {/* Non-color identity per PRD 7.2: the initial doubles as a symbol distinct from color alone. */}
      <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-white" aria-hidden>
        {QUADRANT_INITIAL[color]}
      </span>
    </button>
  );
}
