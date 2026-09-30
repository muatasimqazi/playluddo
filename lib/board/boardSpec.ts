import type { PlayerColor } from "./types";

/**
 * A board's geometry as data, so one engine serves both the 4-arm square
 * cross (2-4 players) and the 6-arm hexagon (5-6 players, F5.2). Everything
 * is *derived* from the arm count rather than hand-tuned, because the two
 * boards are the same structure at different sizes:
 *
 *   - 4 arms -> 4 * 13 = 52 track cells, entries 0/13/26/39, home lane 5,
 *     LAST_TRACK_CELL 50, HOME_LANE_START 51, FINISHED 56.
 *   - 6 arms -> 6 * 13 = 78 track cells, entries 0/13/26/39/52/65, home
 *     lane 5, LAST_TRACK_CELL 76, HOME_LANE_START 77, FINISHED 82.
 *
 * The plpgsql mirror (private.ludo_board_spec) must stay byte-for-byte
 * equivalent to this — see docs/IMPLEMENTATION_HANDOFF.md Section 2 and
 * tests/parity. geometry.ts re-exports the 4-arm spec's values under their
 * historical constant names (TRACK_LENGTH, ENTRY_OFFSET, ...) so existing
 * call sites and fixtures are untouched.
 */

/** Seat/turn order, extended for 5-6 players (F5.2). Index i is seat i. */
export const CLOCKWISE_COLORS: readonly PlayerColor[] = [
  "red",
  "green",
  "yellow",
  "blue",
  "orange",
  "black",
];

/** Cells between one arm's entry and the next — the classic board's spacing. */
const CELLS_PER_ARM = 13;
/** Private home-column length each colour runs before finishing. */
const HOME_LANE_LENGTH = 5;
/** Pawns per player; unchanged across board shapes. */
const PAWNS_PER_PLAYER = 4;
/** Safe (capture-immune) offsets within each arm: its entry, and 8 steps on. */
const SAFE_OFFSETS_IN_ARM = [0, 8] as const;

export interface PathIndexBounds {
  ENTRY: number;
  /** Highest addressable shared-track pathIndex (trackLength - 2). */
  LAST_TRACK_CELL: number;
  /** First private home-lane pathIndex (trackLength - 1). */
  HOME_LANE_START: number;
  /** The finished pathIndex (HOME_LANE_START + homeLaneLength). */
  FINISHED: number;
}

export interface BoardSpec {
  arms: number;
  cellsPerArm: number;
  homeLaneLength: number;
  pawnsPerPlayer: number;
  /** The seat colours this board actually uses (length === arms). */
  colors: readonly PlayerColor[];
  trackLength: number;
  /**
   * Global shared-track index where each colour enters. Populated for ALL six
   * PlayerColors (so it types as a total Record and every call site stays
   * typed); entries for colours not in `colors` are meaningless and never
   * reached, because a board only ever holds pawns of its own `colors`.
   */
  entryOffset: Readonly<Record<PlayerColor, number>>;
  safeCells: ReadonlySet<number>;
  pathIndex: PathIndexBounds;
}

const SPEC_CACHE = new Map<number, BoardSpec>();

export function boardSpec(arms: number): BoardSpec {
  const cached = SPEC_CACHE.get(arms);
  if (cached) return cached;

  const trackLength = arms * CELLS_PER_ARM;
  const colors = CLOCKWISE_COLORS.slice(0, arms);

  const entryOffset = {} as Record<PlayerColor, number>;
  CLOCKWISE_COLORS.forEach((color, index) => {
    entryOffset[color] = index * CELLS_PER_ARM;
  });

  const safeCells = new Set<number>();
  for (let arm = 0; arm < arms; arm++) {
    for (const offset of SAFE_OFFSETS_IN_ARM) {
      safeCells.add(arm * CELLS_PER_ARM + offset);
    }
  }

  const spec: BoardSpec = {
    arms,
    cellsPerArm: CELLS_PER_ARM,
    homeLaneLength: HOME_LANE_LENGTH,
    pawnsPerPlayer: PAWNS_PER_PLAYER,
    colors,
    trackLength,
    entryOffset,
    safeCells,
    pathIndex: {
      ENTRY: 0,
      LAST_TRACK_CELL: trackLength - 2,
      HOME_LANE_START: trackLength - 1,
      FINISHED: trackLength - 1 + HOME_LANE_LENGTH,
    },
  };

  SPEC_CACHE.set(arms, spec);
  return spec;
}

/** The 4-arm square cross board (2-4 players). The engine default. */
export const BOARD_4 = boardSpec(4);
/** The 6-arm hexagonal board (5-6 players, F5.2). */
export const BOARD_6 = boardSpec(6);

/** Which board a room of `maxPlayers` seats uses: 5-6 -> hex, otherwise cross. */
export function boardSpecForPlayers(maxPlayers: number): BoardSpec {
  return maxPlayers >= 5 ? BOARD_6 : BOARD_4;
}

/**
 * Which board a set of seat/pawn colours is on. Orange and black exist only
 * on the hexagon, so their presence means 6 arms — the same inference the
 * SQL engine makes in private.ludo_board_arms, which is why a client given
 * only a room's pawns (a timeline, a replay, the controller) can still decode
 * tile ids and pathIndex boundaries correctly.
 */
export function boardSpecForColors(colors: Iterable<PlayerColor>): BoardSpec {
  for (const color of colors) {
    if (color === "orange" || color === "black") return BOARD_6;
  }
  return BOARD_4;
}

/** boardSpecForColors over a list of pawns or players. */
export function boardSpecForPawns(
  pieces: readonly { color: PlayerColor }[],
): BoardSpec {
  return boardSpecForColors(pieces.map((piece) => piece.color));
}

/** Whether `color` is a seat colour on this board. */
export function isColorOnBoard(spec: BoardSpec, color: PlayerColor): boolean {
  return spec.colors.includes(color);
}
