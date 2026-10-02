/**
 * What a screen reader hears as the game goes on (docs/COMPETITIVE_ROADMAP.md
 * F5.5): rolls, captures, pieces getting home, finishes, whose turn it is and
 * how the match ended — one short sentence each, worked out from the match
 * event log and room state alone. The Simulator reads them out through a
 * polite live region.
 */
import { snakesLayout } from "../board/snakes";
import type { GameRoomState, LegalMove, Player } from "../board/types";
import type { MatchEventRow } from "../realtime/room-channel";
import { describeMove, pieceWhere } from "./controller";

type AnnounceState = Pick<GameRoomState, "gameType" | "players" | "pawns" | "rules">;

/** "You" for this device's own seat, the display name otherwise. */
function who(state: AnnounceState, playerId: string | null, myPlayerId: string | null) {
  if (playerId && playerId === myPlayerId) return "You";
  return state.players.find((p) => p.id === playerId)?.displayName ?? "A player";
}

function ownerOf(state: AnnounceState, pawnId: string): Player | undefined {
  const pawn = state.pawns.find((p) => p.id === pawnId);
  return pawn && state.players.find((p) => p.color === pawn.color);
}

export function ordinal(place: number) {
  const tens = place % 100;
  const suffix =
    tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[place % 10] ?? "th";
  return `${place}${suffix}`;
}

/**
 * One event, in a sentence, or null when it isn't worth interrupting for (a
 * plain move along the track, a chat line, a pause the screen already shows).
 * Any snapshot of the room will do for `state`: it's only used to put names
 * to players and pieces, and a piece's owner never changes.
 */
export function announceEvent(
  event: MatchEventRow,
  state: AnnounceState,
  myPlayerId: string | null,
): string | null {
  const name = who(state, event.player_id, myPlayerId);
  switch (event.event_type) {
    case "dice_rolled": {
      const value = Number(event.payload.dieValue);
      if (!Number.isFinite(value)) return null;
      return event.payload.cancelledByThirdSix
        ? `${name} rolled a ${value}. Three sixes in a row cancel out, so the turn passes.`
        : `${name} rolled a ${value}.`;
    }
    case "legal_move_selected": {
      const move = event.payload as unknown as LegalMove;
      if (typeof move.pawnId !== "string" || typeof move.toTileId !== "string") return null;
      if (state.gameType === "snakes_and_ladders") {
        const to = Number(move.toTileId.split(":")[1]);
        const landing = move.landingSquare ?? to;
        const { ladders, snakes } = snakesLayout(state.rules?.snakesBoard);
        if (ladders[landing] === to) return `${name} climbed a ladder from ${landing} to ${to}.`;
        if (snakes[landing] === to) return `${name} slid down a snake from ${landing} to ${to}.`;
        return `${name} moved to square ${to}.`;
      }
      const captured = (move.capturesPawnIds ?? [])
        .map((id) => ownerOf(state, id))
        .filter((owner): owner is Player => !!owner);
      if (captured.length > 0) {
        const victims = [...new Set(captured.map((owner) => who(state, owner.id, myPlayerId)))];
        const whose = victims.map((v) => (v === "You" ? "your" : `${v}'s`)).join(" and ");
        return `${name} captured ${whose} ${captured.length === 1 ? "piece" : "pieces"}.`;
      }
      if (move.finishesPawn) return `${name} got a piece home.`;
      if (move.fromTileId === null || move.fromTileId.startsWith("nest:"))
        return `${name} brought a piece out of base.`;
      return null;
    }
    case "player_finished": {
      const place = Number(event.payload.place);
      return Number.isFinite(place) && place > 0 ? `${name} finished ${ordinal(place)}.` : null;
    }
    case "decision_timed_out":
      return `${name} ran out of time.`;
    default:
      return null;
  }
}

/** Whose turn it is now, said when the turn passes. */
export function announceTurn(
  state: AnnounceState,
  turnPlayerId: string | null,
  myPlayerId: string | null,
): string | null {
  if (!turnPlayerId) return null;
  if (turnPlayerId === myPlayerId) return "Your turn.";
  return `${who(state, turnPlayerId, myPlayerId)}'s turn.`;
}

/** How the match ended. */
export function announceEnd(
  state: Pick<GameRoomState, "players" | "winnerIds" | "status">,
  myPlayerId: string | null,
): string {
  if (state.status === "abandoned") return "The match has ended.";
  const winner = state.winnerIds[0];
  if (!winner) return "The match is over.";
  if (winner === myPlayerId) return "You win the match!";
  return `${state.players.find((p) => p.id === winner)?.displayName ?? "A player"} wins the match.`;
}

/**
 * A movable piece, for its button in the keyboard piece list: which piece,
 * where it is and what this move does, e.g.
 * "Piece 2, 31 to go: captures Sam's piece".
 */
export function describePieceChoice(state: GameRoomState, move: LegalMove): string {
  const pawn = state.pawns.find((p) => p.id === move.pawnId);
  const where = pawn ? pieceWhere(state, pawn) : "";
  const what = describeMove(state, move).text;
  const label = `Piece ${(pawn?.index ?? 0) + 1}`;
  const midSentence = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  return `${label}${where ? `, ${midSentence(where.replace(" · ", ", "))}` : ""}: ${midSentence(what)}`;
}
