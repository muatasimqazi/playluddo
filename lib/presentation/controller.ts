import { isSafeCell, pathIndexToGlobalCell, PATH_INDEX, tileIdToPathIndex } from "../board/geometry";
import { snakesLayout } from "../board/snakes";
import type { GameRoomState, LegalMove, Pawn, Player } from "../board/types";

/**
 * What a Party Mode phone controller shows (docs/COMPETITIVE_ROADMAP.md
 * Section 6, P3), worked out from the room state alone. The server stays
 * the authority: this only describes the legal moves it already sent.
 */

export type ControllerPhase =
  | "roll" // your turn: roll the die
  | "auto_roll" // your turn, and auto-roll will roll for you
  | "move" // your turn: pick a piece
  | "resolving" // your move is playing out
  | "waiting" // someone else's turn
  | "paused"
  | "reclaim" // a computer is holding your seat
  | "ended";

export function controllerPhase(state: GameRoomState, me: Player): ControllerPhase {
  if (state.status !== "in_game") return "ended";
  if (me.status !== "connected") return "reclaim";
  if (state.paused) return "paused";
  if (state.turnPlayerId !== me.id) return "waiting";
  if (state.turnPhase === "awaiting_roll") return me.autoRollEnabled ? "auto_roll" : "roll";
  if (state.turnPhase === "awaiting_move") return "move";
  return "resolving";
}

/**
 * The piece to play when the roll leaves no real choice: one legal move, or
 * several identical ones (a six with every piece still in base).
 */
export function forcedMovePawnId(legalMoves: readonly LegalMove[]): string | null {
  const [first] = legalMoves;
  if (!first) return null;
  const same = legalMoves.every(
    (m) =>
      m.fromTileId === first.fromTileId &&
      m.toTileId === first.toTileId &&
      m.finishesPawn === first.finishesPawn &&
      m.capturesPawnIds.join() === first.capturesPawnIds.join(),
  );
  return same ? first.pawnId : null;
}

/** Ludo: steps from base (0) to home (57). Snakes & Ladders: the square, 0 off the board. */
export function pieceSteps(state: Pick<GameRoomState, "gameType">, pawn: Pick<Pawn, "pathIndex">) {
  if (pawn.pathIndex === null) return 0;
  return state.gameType === "snakes_and_ladders" ? pawn.pathIndex : pawn.pathIndex + 1;
}

/** The last step: home (Ludo) or square 100. */
export function routeLength(state: Pick<GameRoomState, "gameType">) {
  return state.gameType === "snakes_and_ladders" ? 100 : PATH_INDEX.FINISHED + 1;
}

/** Where a piece is now, in words. */
export function pieceWhere(state: Pick<GameRoomState, "gameType">, pawn: Pawn): string {
  if (state.gameType === "snakes_and_ladders")
    return pawn.pathIndex === null ? "Not on the board yet" : `Square ${pawn.pathIndex}`;
  if (pawn.state === "nest") return "In base";
  if (pawn.state === "finished") return "Home";
  const toGo = PATH_INDEX.FINISHED - (pawn.pathIndex ?? 0);
  if (pawn.state === "home_lane") return `Home column · ${toGo} to go`;
  const onStar = pawn.pathIndex !== null && isSafeCell(pathIndexToGlobalCell(pawn.color, pawn.pathIndex));
  return `${toGo} to go${onStar ? " · safe on a star" : ""}`;
}

export interface MovePreview {
  pawnId: string;
  /** The step the piece ends on, on the same scale as pieceSteps. */
  toSteps: number;
  /** What happens, in words, e.g. "Captures Sam's piece". */
  text: string;
}

/** Describes a legal move for the phone, before the player confirms it. */
export function describeMove(state: GameRoomState, move: LegalMove): MovePreview {
  const pawn = state.pawns.find((p) => p.id === move.pawnId);
  if (state.gameType === "snakes_and_ladders") {
    const { ladders, snakes } = snakesLayout(state.rules?.snakesBoard);
    const to = Number(move.toTileId.split(":")[1]);
    const landing = move.landingSquare ?? to;
    const text =
      pawn?.pathIndex === null
        ? `Onto the board at square ${to}`
        : ladders[landing] === to
          ? `Climbs the ladder from ${landing} to ${to}`
          : snakes[landing] === to
            ? `Slides down the snake from ${landing} to ${to}`
            : to === 100
              ? "Reaches square 100 and wins"
              : `Moves to square ${to}`;
    return { pawnId: move.pawnId, toSteps: to, text };
  }
  const color = pawn?.color ?? state.players[0]?.color ?? "red";
  const toPath = tileIdToPathIndex(color, move.toTileId);
  const toSteps = toPath === null ? 0 : toPath + 1;
  const captured = state.pawns.filter((p) => move.capturesPawnIds.includes(p.id));
  const victims = [
    ...new Set(captured.map((p) => state.players.find((pl) => pl.color === p.color)?.displayName ?? "a player")),
  ];
  let text: string;
  if (move.finishesPawn) text = "Gets home";
  else if (victims.length > 0)
    text = `Captures ${victims.join(" and ")}${victims.length === 1 && captured.length === 1 ? "'s piece" : "'s pieces"}`;
  else if (pawn?.state === "nest") text = "Comes out of base";
  else if (toPath !== null && toPath >= PATH_INDEX.HOME_LANE_START) text = "Into the home column";
  else if (toPath !== null && isSafeCell(pathIndexToGlobalCell(color, toPath))) text = "Lands on a safe star";
  else text = `Moves ${toSteps - pieceSteps(state, pawn ?? { pathIndex: null })} squares`;
  return { pawnId: move.pawnId, toSteps, text };
}

/** How long a party table waits for a missing phone before a computer takes over (P5). */
export const PARTY_WAIT_MS = 2 * 60_000;

/** When a party table's wait for a phone ends, or null if it isn't waiting. */
export function partyWaitEndsAt(state: Pick<GameRoomState, "pausedForPlayerId" | "pausedAt">): string | null {
  if (!state.pausedForPlayerId || !state.pausedAt) return null;
  return new Date(Date.parse(state.pausedAt) + PARTY_WAIT_MS).toISOString();
}

/** 95 → "1:35". */
export function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Finishing order so far (1 = first), for the phone's end screen. */
export function placementOf(state: GameRoomState, playerId: string): number | null {
  const index = state.winnerIds.indexOf(playerId);
  return index === -1 ? null : index + 1;
}
