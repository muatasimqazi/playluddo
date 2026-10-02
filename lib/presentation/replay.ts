import { boardSpecForPawns } from "../board/boardSpec";
import { applyMove } from "../board/rules";
import { applySnakeMove } from "../board/snakes";
import { DEFAULT_ROOM_RULES } from "../board/rules";
import type {
  GameType,
  LegalMove,
  Pawn,
  Player,
  PlayerColor,
  RoomRules,
} from "../board/types";
import type { MatchEventRow } from "../realtime/room-channel";

/**
 * Full match replay (docs/COMPETITIVE_ROADMAP.md F4.3). A finished match is
 * reconstructed purely from its recorded events: the starting snapshot places
 * every piece, then each `legal_move_selected` is re-applied in order. Nothing
 * here re-derives legality or randomness — it only replays what happened, so a
 * replay always matches the game that was played, on either board.
 */

/** One seat as the match started, from the `match_started` snapshot, enriched with names. */
export interface TranscriptSeat {
  playerId: string;
  seatIndex: number;
  color: PlayerColor;
  isBot: boolean;
  displayName: string;
  avatarId: string | null;
}

export interface MatchTranscript {
  matchId: string;
  gameType: GameType;
  rules: RoomRules | null;
  seats: TranscriptSeat[];
  pawns: { pawnId: string; playerId: string; index: number }[];
  events: MatchEventRow[];
  endedAt: string | null;
  endReason: "completed" | "abandoned" | null;
}

export type ReplayStepKind =
  | "start"
  | "roll"
  | "move"
  | "capture"
  | "finish"
  | "end";

export interface ReplayStep {
  /** 0-based position in the replay. */
  index: number;
  /** The event's sequence (0 for the synthetic start step). */
  sequence: number;
  /** The board after this step. */
  pawns: Pawn[];
  /** The die showing, if a roll set it; null before the first roll. */
  dice: number | null;
  /** The seat that acted, for camera focus and highlighting. */
  actorId: string | null;
  caption: string;
  kind: ReplayStepKind;
  /** A capture or a finish — the moments worth a highlight clip. */
  highlight: boolean;
  /** The move applied at this step, so the scene can animate the hop. */
  move: LegalMove | null;
}

export interface Replay {
  gameType: GameType;
  players: Player[];
  steps: ReplayStep[];
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function asMove(event: MatchEventRow): LegalMove | null {
  const p = event.payload;
  if (
    typeof p.pawnId !== "string" ||
    typeof p.toTileId !== "string" ||
    !Array.isArray(p.capturesPawnIds)
  )
    return null;
  return p as unknown as LegalMove;
}

/** A full Player from a snapshot seat — enough for the scene, defaults for the rest. */
function seatToPlayer(seat: TranscriptSeat): Player {
  return {
    id: seat.playerId,
    seatIndex: seat.seatIndex,
    displayName: seat.displayName,
    color: seat.color,
    status: seat.isBot ? "bot" : "connected",
    isBot: seat.isBot,
    missedDecisionCount: 0,
    level: 1,
    testWalletBalance: 0,
    autoRollEnabled: false,
    rematchReady: false,
    inVoice: false,
    cameraOn: false,
    avatarId: seat.avatarId ?? undefined,
  };
}

/** Reconstructs a replayable, captioned step list from a match transcript. */
export function buildReplay(transcript: MatchTranscript): Replay {
  const players = transcript.seats.map(seatToPlayer);
  const colorByPlayer = new Map(transcript.seats.map((s) => [s.playerId, s.color]));
  const nameByPlayer = new Map(transcript.seats.map((s) => [s.playerId, s.displayName]));
  const snakes = transcript.gameType === "snakes_and_ladders";
  const name = (id: string | null) => (id && nameByPlayer.get(id)) || "A player";

  let pawns: Pawn[] = transcript.pawns.map((p) => ({
    id: p.pawnId,
    color: colorByPlayer.get(p.playerId) ?? "red",
    index: p.index,
    state: "nest",
    pathIndex: null,
  }));

  const steps: ReplayStep[] = [
    {
      index: 0,
      sequence: 0,
      pawns,
      dice: null,
      actorId: null,
      caption: "The match begins",
      kind: "start",
      highlight: false,
      move: null,
    },
  ];
  let dice: number | null = null;

  const ordered = [...transcript.events].sort((a, b) => a.sequence - b.sequence);
  for (const event of ordered) {
    const actor = event.player_id;
    if (event.event_type === "dice_rolled") {
      dice = typeof event.payload.dieValue === "number" ? event.payload.dieValue : dice;
      const cancelled = event.payload.cancelledByThirdSix === true;
      steps.push({
        index: steps.length,
        sequence: event.sequence,
        pawns,
        dice,
        actorId: actor,
        caption: cancelled
          ? `${name(actor)} rolled a third six — all three cancelled, turn skipped`
          : `${name(actor)} rolled a ${dice ?? "?"}`,
        kind: "roll",
        highlight: false,
        move: null,
      });
    } else if (event.event_type === "legal_move_selected") {
      const move = asMove(event);
      if (!move) continue;
      pawns = snakes
        ? applySnakeMove(pawns, move)
        : applyMove(pawns, move, boardSpecForPawns(pawns));
      const captured = move.capturesPawnIds.length;
      const kind: ReplayStepKind = captured
        ? "capture"
        : move.finishesPawn
          ? "finish"
          : "move";
      const caption = captured
        ? `${name(actor)} captured ${captured > 1 ? `${captured} pieces` : "a piece"}`
        : move.finishesPawn
          ? snakes
            ? `${name(actor)} reached 100`
            : `${name(actor)} brought a piece home`
          : `${name(actor)} made a move`;
      steps.push({
        index: steps.length,
        sequence: event.sequence,
        pawns,
        dice,
        actorId: actor,
        caption,
        kind,
        highlight: captured > 0 || move.finishesPawn,
        move,
      });
    } else if (event.event_type === "player_finished") {
      // Snakes reports finishing order here (its moves don't carry finishesPawn
      // when a single piece just lands on 100 via the move payload); Ludo's
      // finishing move already produced a "finish" step, so only add one when
      // the previous step wasn't already this seat finishing.
      const place = typeof event.payload.place === "number" ? event.payload.place : null;
      const previous = steps[steps.length - 1];
      if (previous.kind === "finish" && previous.actorId === actor) continue;
      steps.push({
        index: steps.length,
        sequence: event.sequence,
        pawns,
        dice,
        actorId: actor,
        caption: place
          ? `${name(actor)} finished ${ordinal(place)}`
          : `${name(actor)} finished`,
        kind: "finish",
        highlight: true,
        move: null,
      });
    } else if (event.event_type === "match_completed") {
      const winner =
        typeof event.payload.winnerId === "string" ? event.payload.winnerId : actor;
      steps.push({
        index: steps.length,
        sequence: event.sequence,
        pawns,
        dice,
        actorId: winner,
        caption: `${name(winner)} won the match`,
        kind: "end",
        highlight: false,
        move: null,
      });
    }
    // decision_timed_out, chat, reactions, lobby events: not part of the board replay.
  }

  // A completed match with no match_completed event (or an abandoned one) still
  // gets a closing step, so the scrubber always ends on a clear beat.
  const last = steps[steps.length - 1];
  if (last.kind !== "end") {
    steps.push({
      index: steps.length,
      sequence: last.sequence,
      pawns,
      dice,
      actorId: null,
      caption: transcript.endReason === "abandoned" ? "The match was abandoned" : "End of the match",
      kind: "end",
      highlight: false,
      move: null,
    });
  }

  return { gameType: transcript.gameType, players, steps };
}

/** The default rules to fall back on when a transcript predates rule snapshots. */
export const REPLAY_FALLBACK_RULES: RoomRules = DEFAULT_ROOM_RULES;
