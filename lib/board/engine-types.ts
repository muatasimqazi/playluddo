import type { PawnState, PlayerColor } from "./types";

/**
 * The shape the pure rules engine actually operates on — deliberately
 * lighter than the DB-shaped `Pawn` in types.ts (no playerId/boardTileId,
 * which are persistence/rendering concerns). `index` is the stable 0-3
 * ordering used for bot tie-breaks; it mirrors the DB's pawn_index column.
 */
export interface EnginePawn {
  id: string;
  color: PlayerColor;
  index: number;
  state: PawnState;
  /** 0-56, matches types.ts's Pawn.pathIndex convention. Null iff state === "nest". */
  pathIndex: number | null;
}
