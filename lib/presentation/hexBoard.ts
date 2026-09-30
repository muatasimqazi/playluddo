import { BOARD_6, CLOCKWISE_COLORS } from "../board/boardSpec";
import type { PlayerColor } from "../board/types";

/**
 * The 6-arm hexagonal board for 5-6 players (docs/COMPETITIVE_ROADMAP.md
 * F5.2): where every cell, base and nest slot is. Pawns are placed from
 * these numbers, and lib/presentation/hexArtwork.ts prints each board style
 * from them too, so a pawn always lands on its printed cell.
 *
 * It is the square cross generalised from 4 arms to 6. Each arm is a strip
 * 3 cells wide and 6 long pointing out from a central hub, exactly like one
 * arm of the cross; the bases sit in the wedges between arms, as the cross's
 * sit in its corners. The hub is a regular hexagon whose six edges are the
 * arms' inner ends: with an apothem of 1.5 * sqrt(3) cells each edge is
 * exactly 3 cells long, so neighbouring arms meet at a single hub corner and
 * spread apart outward, never overlapping.
 *
 * Coordinates are board-local world units, [x, z], in the same frame as
 * lib/presentation/board.ts's gridPoint (+z towards the viewer at rotation
 * 0). An angle is atan2(z, x). Arm k points along ARM_ANGLE + k * 60deg in
 * CLOCKWISE_COLORS order, so red's arm points to -x like the cross's, and
 * the ring runs red -> green -> yellow -> ... in the direction of increasing
 * angle, as it does on the cross.
 *
 * Per arm, the shared track mirrors the cross (components/arena/
 * boardLayout.ts): out along the arm's leading side (6 cells), across the
 * tip (1), back in along the trailing side (6) — 13 cells, 78 in all. The
 * colour's entry is the trailing side's second cell from the tip (segment
 * index 8, next to its own base), its home column runs down the arm's centre
 * from the tip to the hub, and the last shared cell before it is the tip.
 */

export type Vec2 = readonly [number, number];

/** World units per cell (a cross cell is BOARD_SIZE / 15 = 0.4). */
export const HEX_CELL = 0.305;
/** Hub apothem in cells: makes each hub edge exactly one arm (3 cells) wide. */
const HUB = 1.5 * Math.sqrt(3);
const ARM_CELLS = 6;
const EDGE_MARGIN = 0.2;
const APOTHEM_CELLS = HUB + ARM_CELLS + EDGE_MARGIN;
/** Distance from the centre to the edge midpoint of the printed hexagon. */
export const HEX_ART_APOTHEM = APOTHEM_CELLS * HEX_CELL;
/** Distance from the centre to a corner of the printed hexagon. */
export const HEX_ART_RADIUS = HEX_ART_APOTHEM / Math.cos(Math.PI / 6);
/**
 * The wooden slab's apothem: a thin rim around the print. Its corners reach
 * 3.18 — the cross's half-width — so at any rotation the hexagon lies inside
 * the cross's square and every camera framing that fits the cross fits it
 * too (tests/presentation/hexBoard.test.ts checks). That also keeps a corner
 * turned to +x clear of the desktop die tray, which starts at x = 3.19.
 */
export const HEX_SLAB_APOTHEM = 3.18 * Math.cos(Math.PI / 6);
/** Pawns shrink to the hex cell so neighbours don't overlap. */
export const HEX_PIECE_SCALE = HEX_CELL / 0.4;

/**
 * Base centre distance and radius in cells: about as large as the wedge
 * allows — clear of both neighbouring arms (D/2 - 1.5 >= r) and of the
 * board's two edges at that corner ((corner - D) * sin 60 >= r).
 */
const BASE_DISTANCE = 7.55;
const BASE_RADIUS = 2.15;
/** Half the spacing of the 2x2 nest slots, in cells. */
const NEST_HALF_SPACING = 0.75;
/** Red's arm points to -x, as it does on the cross. */
const ARM_ANGLE = Math.PI;

function armOf(color: PlayerColor): number {
  const arm = CLOCKWISE_COLORS.indexOf(color);
  if (arm < 0 || arm >= BOARD_6.arms) throw new RangeError(`not a hex seat: ${color}`);
  return arm;
}

/** Direction arm `arm` points, as atan2(z, x). */
export function hexArmAngle(arm: number): number {
  return ARM_ANGLE + (arm * Math.PI) / 3;
}

/** Direction from the centre to `color`'s base: between its arm and the next. */
export function hexBaseAngle(color: PlayerColor): number {
  return hexArmAngle(armOf(color)) + Math.PI / 6;
}

function polar(angle: number, distance: number): Vec2 {
  return [Math.cos(angle) * distance, Math.sin(angle) * distance];
}

/**
 * A cell on arm `arm`: `lateral` -1/0/+1 across the arm (+1 is the leading
 * side, facing the previous arm), `radial` 1 (at the hub) to 6 (at the tip).
 */
function armCell(arm: number, lateral: number, radial: number): Vec2 {
  const angle = hexArmAngle(arm);
  const along = HUB + radial - 0.5;
  const dx = Math.cos(angle),
    dz = Math.sin(angle);
  // Leading side: the arm direction turned a quarter towards smaller angles.
  const px = dz,
    pz = -dx;
  return [(dx * along + px * lateral) * HEX_CELL, (dz * along + pz * lateral) * HEX_CELL];
}

/** Arm and segment index (0-12) of a global shared-track cell. */
function segmentOf(globalCell: number): { arm: number; step: number } {
  if (!Number.isInteger(globalCell) || globalCell < 0 || globalCell >= BOARD_6.trackLength) {
    throw new RangeError(`hexTrackPoint: ${globalCell} out of range 0-${BOARD_6.trackLength - 1}`);
  }
  // Each arm's segment starts 8 cells before that colour's entry (k * 13).
  const shifted = (globalCell + 8) % BOARD_6.trackLength;
  return { arm: Math.floor(shifted / BOARD_6.cellsPerArm), step: shifted % BOARD_6.cellsPerArm };
}

function segmentCell(arm: number, step: number): Vec2 {
  if (step <= 5) return armCell(arm, 1, step + 1); // out along the leading side
  if (step === 6) return armCell(arm, 0, ARM_CELLS); // across the tip
  return armCell(arm, -1, 13 - step); // back in along the trailing side
}

/** Centre of global shared-track cell 0-77. */
export function hexTrackPoint(globalCell: number): Vec2 {
  const { arm, step } = segmentOf(globalCell);
  return segmentCell(arm, step);
}

/** Home column cell 0 (next to the tip) to 4 (next to the hub). */
export function hexHomeLanePoint(color: PlayerColor, homeIndex: number): Vec2 {
  if (homeIndex < 0 || homeIndex >= BOARD_6.homeLaneLength)
    throw new RangeError(`hexHomeLanePoint: home index ${homeIndex} out of range`);
  return armCell(armOf(color), 0, ARM_CELLS - 1 - homeIndex);
}

export function hexBaseCenter(color: PlayerColor): Vec2 {
  return polar(hexBaseAngle(color), BASE_DISTANCE * HEX_CELL);
}

/** Base radius in world units. */
export const HEX_BASE_RADIUS = BASE_RADIUS * HEX_CELL;

/** The four nest slots: a 2x2 square in the base, squared to its direction. */
export function hexNestPoint(color: PlayerColor, index: number): Vec2 {
  const angle = hexBaseAngle(color);
  const [cx, cz] = hexBaseCenter(color);
  const along = ((Math.floor(index / 2) % 2) * 2 - 1) * NEST_HALF_SPACING * HEX_CELL;
  const across = ((index % 2) * 2 - 1) * NEST_HALF_SPACING * HEX_CELL;
  return [
    cx + Math.cos(angle) * along - Math.sin(angle) * across,
    cz + Math.sin(angle) * along + Math.cos(angle) * across,
  ];
}

/**
 * Finished pawns leave the print and line up on the table just past the
 * board corner beside their own base, like the cross's finish trays.
 */
export function hexFinishPoint(color: PlayerColor, index: number): Vec2 {
  const angle = hexBaseAngle(color);
  const [cx, cz] = polar(angle, HEX_ART_RADIUS + 0.26);
  const across = (index - 1.5) * 0.34;
  return [cx - Math.sin(angle) * across, cz + Math.cos(angle) * across];
}

/** Where a finishing pawn touches the hub, in its own colour's triangle. */
export function hexGoalPoint(color: PlayerColor): Vec2 {
  return polar(hexArmAngle(armOf(color)), HUB * HEX_CELL * 0.55);
}

/**
 * Board rotation (about +y, as board.ts's HOME_ROTATION) that turns
 * `color`'s arm towards the viewer (+z), so its home column is at the near
 * edge: rotating by phi maps angle a to a - phi, and +z is angle pi/2.
 */
export function hexHomeRotation(color: PlayerColor): number {
  const angle = hexArmAngle(armOf(color)) - Math.PI / 2;
  const turn = Math.PI * 2;
  return ((angle % turn) + turn) % turn;
}

/** A point `distance` out from the centre towards `color`'s base. */
export function hexSeatPoint(color: PlayerColor, distance: number): Vec2 {
  return polar(hexBaseAngle(color), distance);
}

// ---------------------------------------------------------------------------
// For the printed artwork (lib/presentation/hexArtwork.ts)
// ---------------------------------------------------------------------------

/** A point `distance` from the centre at `angle` (atan2(z, x)). */
export function hexPolar(angle: number, distance: number): Vec2 {
  return polar(angle, distance);
}

/** Which arm a shared-track cell sits on, and its step (0-12) along that arm's segment. */
export function hexTrackSegment(globalCell: number): { arm: number; step: number } {
  return segmentOf(globalCell);
}

/** The tip cell of an arm: the last shared cell before that colour's home column. */
export function hexTipPoint(arm: number): Vec2 {
  return armCell(arm, 0, ARM_CELLS);
}

/** Distance from the centre to a corner of the hub hexagon. */
export const HEX_HUB_CORNER = (HUB / Math.cos(Math.PI / 6)) * HEX_CELL;
/** Distance from the centre to the middle of a hub edge (where an arm starts). */
export const HEX_HUB_APOTHEM = HUB * HEX_CELL;
