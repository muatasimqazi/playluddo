import { applyMove } from "../board/rules";
import type { GameRoomState, LegalMove, Pawn } from "../board/types";
import type { MatchEventRow } from "../realtime/room-channel";
import { movementDuration, ROLL_MS } from "./board";

export interface PresentationFrame {
  pawns: Pawn[];
  dice: number;
  rollId: number;
  actorId: string | null;
  busy: boolean;
  replaying: boolean;
  phase: "idle" | "roll" | "move";
  move: LegalMove | null;
  canReplay: boolean;
  revision: number;
  waitingForEvents?: boolean;
}

function asMove(event: MatchEventRow): LegalMove | null {
  const p = event.payload;
  if (
    event.event_type !== "legal_move_selected" ||
    typeof p.pawnId !== "string" ||
    typeof p.toTileId !== "string" ||
    !Array.isArray(p.capturesPawnIds)
  )
    return null;
  return p as unknown as LegalMove;
}

/** A local event player. It never writes to the room store or sends game intents. */
export class PresentationTimeline {
  private frame: PresentationFrame;
  private listeners = new Set<() => void>();
  private queue: MatchEventRow[] = [];
  private seen: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  private latest: GameRoomState;
  private recording: { pawns: Pawn[]; events: MatchEventRow[] } | null = null;
  private replayEvents: MatchEventRow[] = [];
  private liveFrame: PresentationFrame | null = null;

  constructor(state: GameRoomState) {
    this.latest = state;
    this.seen = state.eventSequence;
    this.frame = {
      pawns: state.pawns,
      dice: state.activeDiceValue ?? 1,
      rollId: 0,
      actorId: null,
      busy: false,
      replaying: false,
      phase: "idle",
      move: null,
      canReplay: false,
      revision: 0,
    };
  }

  getSnapshot = () => this.frame;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<PresentationFrame>) {
    this.frame = { ...this.frame, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  receive(events: MatchEventRow[], state: GameRoomState) {
    this.latest = state;
    const fresh = events
      .filter((e) => e.sequence > this.seen)
      .sort((a, b) => a.sequence - b.sequence);
    // Missing durable events after a long disconnect: restore the snapshot directly.
    if (fresh.length && fresh[0].sequence > this.seen + 1) {
      this.restore(state);
      return;
    }
    if (fresh.length) {
      this.seen = fresh[fresh.length - 1].sequence;
      this.queue.push(...fresh);
    }
    const waitingForEvents = state.eventSequence > this.seen;
    if (this.frame.waitingForEvents !== waitingForEvents)
      this.publish({ waitingForEvents });
    if (!this.frame.busy) this.advance();
    clearTimeout(this.reconcileTimer);
    // Event reads may fail while snapshots still arrive. Never strand the board.
    if (state.eventSequence > this.seen)
      this.reconcileTimer = setTimeout(() => this.restore(this.latest), 4500);
  }

  private restore(state: GameRoomState) {
    clearTimeout(this.timer);
    clearTimeout(this.reconcileTimer);
    this.queue = [];
    this.replayEvents = [];
    this.liveFrame = null;
    this.recording = null;
    this.seen = state.eventSequence;
    this.publish({
      pawns: state.pawns,
      dice: state.activeDiceValue ?? this.frame.dice,
      actorId: null,
      busy: false,
      replaying: false,
      phase: "idle",
      move: null,
      canReplay: false,
      waitingForEvents: false,
      revision: this.frame.revision + 1,
    });
  }

  reconcileSnapshot = (state: GameRoomState) => {
    this.latest = state;
    this.restore(state);
  };

  private advance = () => {
    const replaying = this.frame.replaying;
    const event = (replaying ? this.replayEvents : this.queue).shift();
    if (!event) {
      if (replaying && this.liveFrame) {
        const saved = this.liveFrame;
        this.liveFrame = null;
        this.publish({
          ...saved,
          replaying: false,
          busy: false,
          waitingForEvents: this.latest.eventSequence > this.seen,
          revision: this.frame.revision + 1,
        });
        this.advance();
      } else
        this.publish({ busy: false, phase: "idle", move: null, actorId: null });
      return;
    }
    let duration = 0;
    if (
      event.event_type === "dice_rolled" &&
      typeof event.payload.dieValue === "number"
    ) {
      if (!replaying)
        this.recording = { pawns: this.frame.pawns, events: [event] };
      this.publish({
        dice: event.payload.dieValue,
        rollId: this.frame.rollId + 1,
        actorId: event.player_id,
        phase: "roll",
        move: null,
        busy: true,
        canReplay: !replaying,
      });
      duration = ROLL_MS + 180;
    } else {
      const move = asMove(event);
      if (move && this.frame.pawns.some((p) => p.id === move.pawnId)) {
        if (!replaying) {
          if (!this.recording)
            this.recording = { pawns: this.frame.pawns, events: [] };
          this.recording.events.push(event);
        }
        const next = applyMove(this.frame.pawns, move);
        duration = movementDuration(this.frame.pawns, next);
        this.publish({
          pawns: next,
          actorId: event.player_id,
          phase: "move",
          move,
          busy: true,
          canReplay: !replaying,
        });
      }
    }
    if (duration) this.timer = setTimeout(this.advance, duration);
    else this.advance();
  };

  replay = () => {
    if (
      this.frame.busy ||
      this.frame.waitingForEvents ||
      !this.recording?.events.length
    )
      return;
    this.liveFrame = this.frame;
    this.replayEvents = [...this.recording.events];
    this.publish({
      pawns: this.recording.pawns,
      replaying: true,
      busy: true,
      move: null,
      phase: "idle",
      revision: this.frame.revision + 1,
    });
    this.timer = setTimeout(this.advance, 100);
  };

  stopReplay = () => {
    if (!this.frame.replaying || !this.liveFrame) return;
    clearTimeout(this.timer);
    this.replayEvents = [];
    const saved = this.liveFrame;
    this.liveFrame = null;
    this.publish({
      ...saved,
      waitingForEvents: this.latest.eventSequence > this.seen,
      revision: this.frame.revision + 1,
    });
    this.advance();
  };

  dispose = () => {
    clearTimeout(this.timer);
    clearTimeout(this.reconcileTimer);
  };
}
