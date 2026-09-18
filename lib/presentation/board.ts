import type { GameType, LegalMove, Pawn, PlayerColor } from "../board/types";
import { pathIndexToGlobalCell, PATH_INDEX } from "../board/geometry";
import {
  BASE_AREA,
  globalCellToGridPosition,
  HOME_LANE_CELLS,
} from "../../components/arena/boardLayout";
import { NEST_SLOT_POSITIONS } from "../../components/arena/boardArtworkGeometry";

export const BOARD_SIZE = 6;
export const BOARD_Y = 0.19;
export const CELL = BOARD_SIZE / 15;
export const COLORS: Record<PlayerColor, string> = {
  red: "#c74b43",
  green: "#43876b",
  yellow: "#d9ab42",
  blue: "#487ab3",
};
export const HOME_ROTATION: Record<PlayerColor, number> = {
  blue: 0,
  red: Math.PI / 2,
  green: Math.PI,
  yellow: Math.PI * 1.5,
};
export type Point = [number, number, number];
export type CameraView =
  | "play"
  | "overhead"
  | "table"
  | "north"
  | "east"
  | "west";
export type InteractionMode = "play" | "look" | "rotate";
export type Quality = "low" | "medium" | "high" | "ultra";
export type ActionCamera = "off" | "subtle" | "cinematic";

export function gridPoint(row: number, col: number): Point {
  return [(col - 7) * CELL, BOARD_Y, (row - 7) * CELL];
}

function finalGoalPoint(color: PlayerColor): Point {
  const end: Record<PlayerColor, Point> = {
    blue: [0, BOARD_Y, 0.34],
    green: [0, BOARD_Y, -0.34],
    red: [-0.34, BOARD_Y, 0],
    yellow: [0.34, BOARD_Y, 0],
  };
  return end[color];
}

/** Canonical logical coordinates only. No DOM measurements or camera transforms. */
export function pawnPoint(pawn: Pawn, gameType: GameType = "ludo"): Point {
  if (gameType === "snakes_and_ladders") {
    if (pawn.state === "finished")
      return [
        -3.48,
        0.02,
        -2.7 + ["blue", "red", "green", "yellow"].indexOf(pawn.color) * 0.44,
      ];
    if (pawn.pathIndex === null)
      return [
        -2.7 + ["blue", "red", "green", "yellow"].indexOf(pawn.color) * 0.44,
        0.02,
        3.32,
      ];
    return snakeSquarePoint(pawn.pathIndex);
  }
  if (pawn.pathIndex === null) {
    const base = BASE_AREA[pawn.color];
    // Corner star badges measured from the custom board artwork.
    const [left, top] = NEST_SLOT_POSITIONS[pawn.color][pawn.index];
    return gridPoint(
      base.rowStart + (top / 100) * 6 - 0.5,
      base.colStart + (left / 100) * 6 - 0.5,
    );
  }
  if (pawn.pathIndex < PATH_INDEX.HOME_LANE_START) {
    const { row, col } = globalCellToGridPosition(
      pathIndexToGlobalCell(pawn.color, pawn.pathIndex),
    );
    return gridPoint(row, col);
  }
  if (pawn.pathIndex < PATH_INDEX.FINISHED) {
    const [row, col] =
      HOME_LANE_CELLS[pawn.color][pawn.pathIndex - PATH_INDEX.HOME_LANE_START];
    return gridPoint(row, col);
  }
  // Finished discs leave the printed board and line up on the tabletop
  // beside their own corner. Keeping these positions board-local means the
  // tray follows its matching base when the player rotates the board.
  const offset = (pawn.index - 1.5) * 0.42;
  const end: Record<PlayerColor, Point> = {
    red: [-3.48, BOARD_Y, -1.8 + offset],
    green: [3.48, BOARD_Y, -1.8 + offset],
    yellow: [3.48, BOARD_Y, 1.8 + offset],
    blue: [-3.48, BOARD_Y, 1.8 + offset],
  };
  return end[pawn.color];
}

/** Includes every square, including the transition into the private home lane. */
export function moveWaypoints(
  from: Pawn,
  to: Pawn,
  gameType: GameType = "ludo",
  move?: LegalMove | null,
): Point[] {
  if (gameType === "snakes_and_ladders") {
    if (to.pathIndex === null) return [pawnPoint(to, gameType)];
    const landing = move?.landingSquare ?? to.pathIndex;
    const path = Array.from(
      { length: Math.max(0, landing - (from.pathIndex ?? 0)) },
      (_, i) => snakeSquarePoint((from.pathIndex ?? 0) + i + 1),
    );
    if (landing !== to.pathIndex) {
      const start = snakeSquarePoint(landing),
        end = snakeSquarePoint(to.pathIndex);
      // A continuous slide between the printed endpoints, with a gentle snake curve.
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const curve =
          landing > to.pathIndex
            ? Math.sin(t * Math.PI * 4) * Math.sin(t * Math.PI) * 0.22
            : 0;
        path.push([
          start[0] + (end[0] - start[0]) * t + curve,
          BOARD_Y + Math.sin(t * Math.PI) * 0.035,
          start[2] + (end[2] - start[2]) * t,
        ]);
      }
    }
    if (to.state === "finished") path.push(pawnPoint(to, gameType));
    return path;
  }
  if (to.pathIndex === null || from.pathIndex === null) return [pawnPoint(to)];
  if (to.pathIndex <= from.pathIndex) return [pawnPoint(to)];
  const path = Array.from({ length: to.pathIndex - from.pathIndex }, (_, i) =>
    pawnPoint({ ...to, pathIndex: from.pathIndex! + i + 1 }),
  );
  if (to.pathIndex === PATH_INDEX.FINISHED) {
    // Touch the center goal first, then clear the board into the finish tray.
    path.splice(path.length - 1, 0, finalGoalPoint(to.color));
  }
  return path;
}

export function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export const ROLL_MS = 1000;
export const HOP_MS = 150;

export function movementDuration(
  from: Pawn[],
  to: Pawn[],
  gameType: GameType = "ludo",
  move?: LegalMove,
): number {
  let steps = 1;
  for (const pawn of to) {
    const previous = from.find((p) => p.id === pawn.id);
    if (
      previous &&
      (pawn.pathIndex !== previous.pathIndex || pawn.id === move?.pawnId) &&
      pawn.pathIndex !== null
    )
      steps = Math.max(
        steps,
        moveWaypoints(previous, pawn, gameType, move).length,
      );
  }
  return steps * HOP_MS + 550;
}

/** Printed rows alternate direction, starting with 1 at the bottom left. */
export function snakeSquarePoint(square: number): Point {
  const row = Math.floor((square - 1) / 10);
  const column = (square - 1) % 10;
  return [
    ((row % 2 ? 9 - column : column) - 4.5) * 0.6,
    BOARD_Y,
    (4.5 - row) * 0.6,
  ];
}
