import type { GameType, LegalMove, Pawn, PlayerColor } from "../board/types";
import { BOARD_4, type BoardSpec } from "../board/boardSpec";
import { pathIndexToGlobalCell, PATH_INDEX } from "../board/geometry";
import {
  BASE_AREA,
  globalCellToGridPosition,
  HOME_LANE_CELLS,
} from "../../components/arena/boardLayout";
import { NEST_SLOT_POSITIONS } from "../../components/arena/boardArtworkGeometry";
import {
  HEX_PIECE_SCALE,
  hexFinishPoint,
  hexGoalPoint,
  hexHomeLanePoint,
  hexHomeRotation,
  hexNestPoint,
  hexTrackPoint,
  type Vec2,
} from "./hexBoard";

export const BOARD_SIZE = 6;
export const BOARD_Y = 0.19;
export const CELL = BOARD_SIZE / 15;
export const COLORS: Record<PlayerColor, string> = {
  red: "#c74b43",
  green: "#43876b",
  yellow: "#d9ab42",
  blue: "#487ab3",
  // F5.2 hex seats. Chosen to stay distinct from the four above for
  // colour-vision safety (F5.5): a warm saturated orange (away from the
  // muted yellow) and a dark slate that reads as a neutral sixth token.
  orange: "#d9772f",
  black: "#3b3b46",
};
/**
 * Board rotation that brings a colour's home column to the near edge, on the
 * 4-arm cross. The hexagon turns in sixths, so the four shared colours need
 * different angles there — use homeRotation(color, spec) when the board may
 * be either. Orange and black only exist on the hexagon, so theirs are the
 * hex angles.
 */
export const HOME_ROTATION: Record<PlayerColor, number> = {
  blue: 0,
  red: Math.PI / 2,
  green: Math.PI,
  yellow: Math.PI * 1.5,
  orange: hexHomeRotation("orange"),
  black: hexHomeRotation("black"),
};

export function homeRotation(color: PlayerColor, spec: BoardSpec = BOARD_4): number {
  return spec.arms === 6 ? hexHomeRotation(color) : HOME_ROTATION[color];
}

// The four seats around the square table, clockwise from the far left.
const SQUARE_SEATS: readonly PlayerColor[] = ["red", "green", "yellow", "blue"];

/**
 * Which colour's seat a player sits in around the table. Luddo seats follow
 * the bases, and the board turns to bring yours near (homeRotation). The
 * Snakes & Ladders print stays upright, so the seats turn instead: you take
 * the near-left seat, blue's, and everyone keeps their place around you.
 */
export function seatColor(
  color: PlayerColor,
  gameType: GameType | undefined,
  myColor: PlayerColor | undefined,
): PlayerColor {
  if (gameType !== "snakes_and_ladders" || !myColor) return color;
  const seat = SQUARE_SEATS.indexOf(color);
  const mine = SQUARE_SEATS.indexOf(myColor);
  if (seat < 0 || mine < 0) return color;
  return SQUARE_SEATS[(seat - mine + 3) % 4];
}

/** One snap of the board when turning it: a quarter on the cross, a sixth on the hex. */
export function rotationStep(spec: BoardSpec = BOARD_4): number {
  return (Math.PI * 2) / spec.arms;
}

/** Pawn scale for this board: hex cells are smaller than the cross's. */
export function pieceScale(spec: BoardSpec = BOARD_4): number {
  return spec.arms === 6 ? HEX_PIECE_SCALE : 1;
}
/**
 * Each color's diagonally-opposite base on the board (BASE_AREA in
 * components/arena/boardLayout.ts: red=top-left, green=top-right,
 * yellow=bottom-right, blue=bottom-left). Mirrors the seat_index pairing
 * ((seat + 2) % 4) the SQL engine uses so a 2-player game seats the two
 * players across the table from each other.
 */
export const DIAGONAL_COLOR: Record<PlayerColor, PlayerColor> = {
  red: "yellow",
  yellow: "red",
  green: "blue",
  blue: "green",
  // F5.2: diagonal seating is a 2-player (4-arm board) concept only; orange
  // and black never reach it, so these are inert opposite-pair placeholders.
  orange: "black",
  black: "orange",
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

const onBoard = ([x, z]: Vec2): Point => [x, BOARD_Y, z];

function finalGoalPoint(color: PlayerColor, spec: BoardSpec = BOARD_4): Point {
  if (spec.arms === 6) return onBoard(hexGoalPoint(color));
  const end: Record<PlayerColor, Point> = {
    blue: [0, BOARD_Y, 0.34],
    green: [0, BOARD_Y, -0.34],
    red: [-0.34, BOARD_Y, 0],
    yellow: [0.34, BOARD_Y, 0],
    // Hex-only colours: that board's goal points come from hexGoalPoint above.
    orange: [0, BOARD_Y, 0],
    black: [0, BOARD_Y, 0],
  };
  return end[color];
}

/** A Luddo pawn on the 6-arm hexagon (lib/presentation/hexBoard.ts). */
function hexPawnPoint(pawn: Pawn, spec: BoardSpec): Point {
  if (pawn.pathIndex === null) return onBoard(hexNestPoint(pawn.color, pawn.index));
  const { HOME_LANE_START, FINISHED } = spec.pathIndex;
  if (pawn.pathIndex < HOME_LANE_START)
    return onBoard(hexTrackPoint(pathIndexToGlobalCell(pawn.color, pawn.pathIndex, spec)));
  if (pawn.pathIndex < FINISHED)
    return onBoard(hexHomeLanePoint(pawn.color, pawn.pathIndex - HOME_LANE_START));
  return onBoard(hexFinishPoint(pawn.color, pawn.index));
}

/**
 * Canonical logical coordinates only. No DOM measurements or camera transforms.
 * `spec` picks the Luddo board: the 4-arm cross (default) or the 6-arm hexagon.
 */
export function pawnPoint(
  pawn: Pawn,
  gameType: GameType = "ludo",
  spec: BoardSpec = BOARD_4,
): Point {
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
  if (spec.arms === 6) return hexPawnPoint(pawn, spec);
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
    // Hex-only colours never reach the cross (see hexPawnPoint).
    orange: [0, BOARD_Y, -3.48 + offset],
    black: [0, BOARD_Y, 3.48 + offset],
  };
  return end[pawn.color];
}

/** Includes every square, including the transition into the private home lane. */
export function moveWaypoints(
  from: Pawn,
  to: Pawn,
  gameType: GameType = "ludo",
  move?: LegalMove | null,
  spec: BoardSpec = BOARD_4,
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
  if (to.pathIndex === null || from.pathIndex === null)
    return [pawnPoint(to, gameType, spec)];
  if (to.pathIndex <= from.pathIndex) return [pawnPoint(to, gameType, spec)];
  const path = Array.from({ length: to.pathIndex - from.pathIndex }, (_, i) =>
    pawnPoint({ ...to, pathIndex: from.pathIndex! + i + 1 }, gameType, spec),
  );
  if (to.pathIndex === spec.pathIndex.FINISHED) {
    // Touch the center goal first, then clear the board into the finish tray.
    path.splice(path.length - 1, 0, finalGoalPoint(to.color, spec));
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
  spec: BoardSpec = BOARD_4,
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
        moveWaypoints(previous, pawn, gameType, move, spec).length,
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
