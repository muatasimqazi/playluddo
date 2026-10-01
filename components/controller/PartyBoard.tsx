"use client";

import { useMemo, type KeyboardEvent } from "react";
import type { GameRoomState, LegalMove, Pawn, PlayerColor } from "@/lib/board/types";
import { applyMove } from "@/lib/board/rules";
import { applySnakeMove } from "@/lib/board/snakes";
import { boardSpecForPawns } from "@/lib/board/boardSpec";
import { COLORS, homeRotation, moveWaypoints, pawnPoint } from "@/lib/presentation/board";
import { HEX_ART_RADIUS } from "@/lib/presentation/hexBoard";
import { useI18n } from "@/lib/i18n";
import classicBoardArt from "@/designs/board-classic.svg";
import hexClassicBoardArt from "@/designs/board-hex-classic.svg";
import snakesBoardArt from "@/designs/snake-and-ladder/snakes-and-ladders-board.svg";
import snakesBoardArt2 from "@/designs/snake-and-ladder/snakes-and-ladders-board-2.svg";

/** Half the drawing's width in board units: the board, or with the finish trays beside it. */
const BOARD_EXTENT = 3.15;
const TRAY_EXTENT = 3.8;

/**
 * The board, flat, on a Party phone (docs/COMPETITIVE_ROADMAP.md P3: "a 2D
 * mini-board of your colour, with legal pieces glowing"). Every piece sits
 * where the TV shows it — the same board-local coordinates the 3D table
 * uses (lib/presentation/board.ts) — turned so your base is bottom-left, as
 * on your own phone. On your move the pieces you can play glow; tapping one
 * draws its route square by square to where it lands and rings any piece it
 * would capture. Plain Classic artwork, whatever the TV shows: flat colours
 * read best at this size.
 */
export function PartyBoard({
  state,
  color,
  legalPawnIds,
  selected,
  onSelect,
}: {
  state: GameRoomState;
  /** Your colour: your pieces are numbered and the board turns to your base. */
  color: PlayerColor;
  /** Pieces you can move now; empty when it isn't your move. */
  legalPawnIds: readonly string[];
  selected: string | null;
  onSelect?: (pawnId: string) => void;
}) {
  const { t } = useI18n();
  const snakes = state.gameType === "snakes_and_ladders";
  const spec = boardSpecForPawns(state.pawns);
  const hex = !snakes && spec.arms === 6;
  const art = snakes
    ? ((state.rules?.snakesBoard === 1 ? snakesBoardArt2 : snakesBoardArt).src as string)
    : ((hex ? hexClassicBoardArt : classicBoardArt).src as string);
  const artExtent = hex ? HEX_ART_RADIUS : 3;
  // Finished pieces line up beside the board; only then does it need the room.
  const EXTENT = state.pawns.some((p) => p.state === "finished") ? TRAY_EXTENT : Math.max(BOARD_EXTENT, artExtent + 0.15);
  // Snakes & Ladders stays upright: its squares are numbered.
  const turn = snakes ? 0 : (-homeRotation(color, spec) * 180) / Math.PI;

  const where = (pawn: Pawn): [number, number] => {
    const [x, , z] = pawnPoint(pawn, state.gameType, spec);
    return [x, z];
  };
  // Pieces sharing a square fan out a little so each can still be seen and tapped.
  const placed = useMemo(() => {
    const byCell = new Map<string, Pawn[]>();
    for (const pawn of state.pawns) {
      const [x, z] = where(pawn);
      const key = `${x.toFixed(2)},${z.toFixed(2)}`;
      byCell.set(key, [...(byCell.get(key) ?? []), pawn]);
    }
    const out = new Map<string, [number, number]>();
    for (const group of byCell.values())
      group.forEach((pawn, i) => {
        const [x, z] = where(pawn);
        const spread = group.length > 1 ? 0.13 : 0;
        const angle = (i / group.length) * Math.PI * 2;
        out.set(pawn.id, [x + Math.cos(angle) * spread, z + Math.sin(angle) * spread]);
      });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `where` only reads these.
  }, [state.pawns, state.gameType]);

  const move: LegalMove | undefined = selected
    ? state.legalMoves.find((m) => m.pawnId === selected)
    : undefined;
  const route = useMemo(() => {
    if (!move) return null;
    const from = state.pawns.find((p) => p.id === move.pawnId);
    const next = snakes ? applySnakeMove(state.pawns, move) : applyMove(state.pawns, move, spec);
    const to = next.find((p) => p.id === move.pawnId);
    if (!from || !to) return null;
    const points = [where(from), ...moveWaypoints(from, to, state.gameType, move, spec).map(([x, , z]) => [x, z] as [number, number])];
    return { points, end: points[points.length - 1] };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `where` only reads these.
  }, [move, state.pawns, state.gameType, snakes]);

  const legal = new Set(legalPawnIds);
  const mineFirst = [...state.pawns].sort(
    (a, b) => Number(a.color === color) - Number(b.color === color) || Number(legal.has(a.id)) - Number(legal.has(b.id)),
  );
  const pick = (pawnId: string) => onSelect?.(pawnId);
  const onKey = (event: KeyboardEvent, pawnId: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    pick(pawnId);
  };

  return (
    <svg
      className="party-board"
      viewBox={`${-EXTENT} ${-EXTENT} ${EXTENT * 2} ${EXTENT * 2}`}
      role="group"
      aria-label={t("party.boardAria")}
      style={{ "--seat": COLORS[color] } as React.CSSProperties}
    >
      <g transform={`rotate(${turn})`}>
        <image
          href={art}
          x={-artExtent}
          y={-artExtent}
          width={artExtent * 2}
          height={artExtent * 2}
          preserveAspectRatio="none"
        />
        {route && (
          <>
            <polyline
              className="party-board-route"
              points={route.points.map(([x, z]) => `${x},${z}`).join(" ")}
            />
            <circle className="party-board-landing" cx={route.end[0]} cy={route.end[1]} r={0.27} />
          </>
        )}
        {move?.capturesPawnIds.map((id) => {
          const at = placed.get(id);
          return at ? <circle key={id} className="party-board-capture" cx={at[0]} cy={at[1]} r={0.3} /> : null;
        })}
        {mineFirst.map((pawn) => {
          const at = placed.get(pawn.id);
          if (!at) return null;
          const mine = pawn.color === color;
          const canMove = legal.has(pawn.id);
          const isSelected = pawn.id === selected;
          const label = snakes ? "" : String(pawn.index + 1);
          return (
            <g
              key={pawn.id}
              className={`party-board-piece${mine ? " is-mine" : ""}${canMove ? " is-legal" : ""}${isSelected ? " is-selected" : ""}`}
              transform={`translate(${at[0]} ${at[1]})`}
              {...(canMove
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-pressed": isSelected,
                    "aria-label": snakes ? t("party.yourPiece") : t("party.pieceN", { n: pawn.index + 1 }),
                    onClick: () => pick(pawn.id),
                    onKeyDown: (e: KeyboardEvent) => onKey(e, pawn.id),
                  }
                : { "aria-hidden": true })}
            >
              {canMove && <circle className="party-board-glow" r={0.3} />}
              {/* A finger-sized target around a small piece. */}
              {canMove && <circle className="party-board-hit" r={0.45} />}
              <circle className="party-board-disc" r={mine ? 0.2 : 0.15} fill={COLORS[pawn.color]} />
              {mine && label && (
                <text className="party-board-number" transform={`rotate(${-turn})`} dy="0.07">
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
