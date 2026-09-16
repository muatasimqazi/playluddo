import type { Pawn, PlayerColor } from "../board/types";
import { pathIndexToGlobalCell, PATH_INDEX } from "../board/geometry";
import {
  BASE_AREA,
  globalCellToGridPosition,
  HOME_LANE_CELLS,
} from "../../components/arena/boardLayout";

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

/** Canonical logical coordinates only. No DOM measurements or camera transforms. */
export function pawnPoint(pawn: Pawn): Point {
  if (pawn.pathIndex === null) {
    const base = BASE_AREA[pawn.color];
    return gridPoint(
      base.rowStart + 1.5 + Math.floor(pawn.index / 2) * 2,
      base.colStart + 1.5 + (pawn.index % 2) * 2,
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
  const offset = (pawn.index - 1.5) * 0.15;
  const end: Record<PlayerColor, Point> = {
    blue: [offset, BOARD_Y, 0.34],
    green: [offset, BOARD_Y, -0.34],
    red: [-0.34, BOARD_Y, offset],
    yellow: [0.34, BOARD_Y, offset],
  };
  return end[pawn.color];
}

/** Includes every square, including the transition into the private home lane. */
export function moveWaypoints(from: Pawn, to: Pawn): Point[] {
  if (to.pathIndex === null || from.pathIndex === null) return [pawnPoint(to)];
  if (to.pathIndex <= from.pathIndex) return [pawnPoint(to)];
  return Array.from({ length: to.pathIndex - from.pathIndex }, (_, i) =>
    pawnPoint({ ...to, pathIndex: from.pathIndex! + i + 1 }),
  );
}

export function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export const ROLL_MS = 1000;
export const HOP_MS = 150;

export function movementDuration(from: Pawn[], to: Pawn[]): number {
  let steps = 1;
  for (const pawn of to) {
    const previous = from.find((p) => p.id === pawn.id);
    if (
      previous &&
      pawn.pathIndex !== previous.pathIndex &&
      pawn.pathIndex !== null
    )
      steps = Math.max(steps, moveWaypoints(previous, pawn).length);
  }
  return steps * HOP_MS + 550;
}
