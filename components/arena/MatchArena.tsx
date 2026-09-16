"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AnimatePresence, motion } from "framer-motion";
import { Board } from "./Board";
import { Dice } from "./Dice";
import { StatusPod, pawnCountFor } from "./StatusPod";
import { ActivityFeed } from "./ActivityFeed";
import { RpcError, requestMove, requestRoll, toggleAutoRoll } from "@/lib/supabase/rpc";
import { useRoomStore } from "@/lib/store/room-store";
import type { GameRoomState, Player, PlayerColor } from "@/lib/board/types";

interface MatchArenaProps {
  client: SupabaseClient;
  roomId: string;
}

// Quadrant layout, top-left/top-right/bottom-left/bottom-right — matches
// BASE_AREA in boardLayout.ts, so a seat's status pod sits on the same side
// of the board as its own base.
const QUADRANT_SLOTS: readonly { color: PlayerColor; corner: "tl" | "tr" | "bl" | "br" }[] = [
  { color: "red", corner: "tl" },
  { color: "green", corner: "tr" },
  { color: "blue", corner: "bl" },
  { color: "yellow", corner: "br" },
];

// Standalone dice, next to (not inside) each name card — per direct
// instruction, on the side that already faces "inward" for that card:
// red/blue (left-column, align="left") on their own right; green/yellow
// (right-column, align="right") on their own left. Confirmed explicitly
// after an earlier ambiguous answer: red right, green left, blue right,
// yellow left — exactly what QUADRANT_SLOTS' existing align already
// encodes, so no separate per-color table is needed here.
const INLINE_DICE_SIZE = 40;

// Per direct instruction: the roll happens quickly, and the interactive
// dice box disappearing the INSTANT a turn ends (previous behavior) made
// it hard to actually see the face that was just rolled before play moved
// on. Hold it here a bit longer. Deliberately per-pod ("isCurrentTurn OR
// I'm the held roll") rather than one global "which pod owns the dice
// right now" switch: the alternative — suppressing the NEW current
// player's own box until the hold expires — would delay their roll
// control being usable, which is worse than the box briefly existing in
// two places at once. What made that double-box confusing before wasn't
// the overlap itself, it's that both looked equally "live"; the held one
// below is dimmed and non-interactive so it reads as a recap, not a
// second control.
const DICE_HOLD_MS = 3800;

// Sound is a purely local playback preference (unlike Auto-Roll, which is
// per-player server state everyone else's client also needs to see) — so
// it lives in this browser's localStorage, not the room's DB row.
const SOUND_MUTED_STORAGE_KEY = "ludo-sound-muted";

export function MatchArena({ client, roomId }: MatchArenaProps) {
  const roomState = useRoomStore((s) => s.roomState);
  const events = useRoomStore((s) => s.events);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const connectionToken = useRoomStore((s) => s.connectionToken);
  const setSessionReplaced = useRoomStore((s) => s.setSessionReplaced);
  const sessionReplaced = useRoomStore((s) => s.sessionReplaced);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Lazy initializer (not a useEffect) so the very first render already
  // reflects a previously-saved preference instead of flashing unmuted
  // for one frame — window is absent during SSR, where "unmuted" is a
  // harmless default since no audio plays there anyway.
  const [soundMuted, setSoundMuted] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === "1",
  );

  function handleToggleSound(muted: boolean) {
    setSoundMuted(muted);
    try {
      window.localStorage.setItem(SOUND_MUTED_STORAGE_KEY, muted ? "1" : "0");
    } catch {
      // Private-browsing/storage-disabled: the toggle still works for this
      // session, it just won't be remembered next visit.
    }
  }

  // The board's own rendered width is no longer a static breakpoint at
  // lg+ (it's height-driven — see Board.tsx) so the pod rows/banner can't
  // just share the same Tailwind max-w-* classes to stay visually aligned
  // with it anymore. Measure the board directly and mirror its width onto
  // them instead. A callback ref (not useRef+useEffect) because it needs
  // to (re)attach the observer exactly when Board's root element itself
  // mounts/unmounts — which, since Board is behind the `!roomState` early
  // return below, doesn't necessarily happen on this component's own
  // mount.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [boardWidth, setBoardWidth] = useState<number | null>(null);
  const boardRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!node) return;
    // entry.contentRect excludes padding/border — Board.tsx's root has
    // both (p-2/p-4, a 1px border), so it under-measures the board's
    // actual visible edge by ~30px and the pod rows would end up that
    // much narrower than the board, not aligned with it. getBoundingClientRect
    // reports the full border-box, matching what's actually on screen.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBoardWidth(Math.round(entry.target.getBoundingClientRect().width));
    });
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, []);

  // The match_events log (already fetched for the Activity Feed) turns out
  // to be a far more reliable source for "what did each player roll" than
  // roomState.activeDiceValue: per ludo_perform_roll's "No-move turn"
  // branch (all pawns nested, non-six — no legal move exists), the server
  // advances the turn in the SAME update that would have set
  // active_dice_value, so the client can go straight from one player's
  // awaiting_roll to the next player's awaiting_roll without
  // activeDiceValue ever passing through that roll's value at all — "the
  // dice roll doesn't show up" is that case exactly. A 'dice_rolled' event
  // is appended unconditionally on every roll, though (see the SQL), so
  // deriving from `events` instead can't miss one.
  const lastRollByPlayerId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const event of events) {
      if (event.event_type !== "dice_rolled" || !event.player_id) continue;
      const dieValue = event.payload?.dieValue;
      if (typeof dieValue === "number") map[event.player_id] = dieValue;
    }
    return map;
  }, [events]);

  // The single most recent roll, if any — reference-stable across renders
  // where it hasn't actually changed (same array element from `events`,
  // not a fresh object), which is what lets the effect below key off it
  // directly instead of needing its own separate "is this new" guard.
  const latestRollEvent = useMemo(
    () => events.findLast((event) => event.event_type === "dice_rolled") ?? null,
    [events],
  );

  // Plays for every roll (mine, another player's, or a bot's — anyone
  // this client is watching), not just the local tap-to-roll click:
  // latestRollEvent already fires for a no-legal-move roll too, which
  // never touches activeDiceValue at all. Guarded by "have I already
  // played for this event," seeded to the CURRENT latestRollEvent on
  // first render (undefined sentinel, not null — a room can genuinely
  // have no rolls yet) so joining or reconnecting mid-match doesn't
  // replay a sound for history that happened before this client was
  // here — only a roll that arrives after mount should ever play.
  const playedRollEventIdRef = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!latestRollEvent) return;
    if (playedRollEventIdRef.current === undefined) {
      playedRollEventIdRef.current = latestRollEvent.id;
      return;
    }
    if (latestRollEvent.id === playedRollEventIdRef.current) return;
    playedRollEventIdRef.current = latestRollEvent.id;
    if (soundMuted) return;
    // A fresh Audio per play (not one shared/reused instance) so two
    // rolls landing close together — easy with bots — overlap instead of
    // the second cutting the first's tail off by restarting it.
    const audio = new Audio("/sounds/dice-roll.wav");
    void audio.play().catch(() => {});
  }, [latestRollEvent, soundMuted]);

  // heldRoll mirrors latestRollEvent but stays truthy for DICE_HOLD_MS
  // after it, so the pod dice doesn't just vanish the instant the turn
  // moves on. Derived state (an expiry marker set by a timer effect, not
  // the value itself set from inside the effect) to satisfy
  // react-hooks/set-state-in-effect: derived state belongs in render, not
  // an effect.
  const [expiredRollEventId, setExpiredRollEventId] = useState<number | null>(null);

  useEffect(() => {
    if (!latestRollEvent) return;
    const timer = setTimeout(() => setExpiredRollEventId(latestRollEvent.id), DICE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [latestRollEvent]);

  const heldRoll = useMemo(() => {
    if (!latestRollEvent || latestRollEvent.id === expiredRollEventId) return null;
    const dieValue = latestRollEvent.payload?.dieValue;
    const playerId = latestRollEvent.player_id;
    if (typeof dieValue !== "number" || !playerId) return null;
    return { playerId, value: dieValue };
  }, [latestRollEvent, expiredRollEventId]);

  // Which player's pod should LOOK active (border, scale, dice box) —
  // per direct instruction, the turn switch itself should hold for the
  // same DICE_HOLD_MS the dice face does, instead of the card highlight
  // jumping to the new player while the old player's dice is still
  // sitting there. A single value (not a per-pod OR) because unlike the
  // dice box, there's no reason for two cards to ever look active at
  // once — nothing here needs the new player's own card to be
  // immediately interactive the way their roll control does.
  const displayedTurnPlayerId = heldRoll?.playerId ?? roomState?.turnPlayerId ?? null;

  const myPlayer = roomState?.players.find((p) => p.id === myPlayerId) ?? null;
  const isMyTurn = roomState !== null && roomState.turnPlayerId === myPlayerId;
  const legalPawnIds = useMemo(
    () => new Set(isMyTurn && roomState ? roomState.legalMoves.map((m) => m.pawnId) : []),
    [roomState, isMyTurn],
  );

  if (!roomState) return null;

  // Applied as an inline max-width alongside the same max-w-* classes
  // Board.tsx itself falls back to below lg (so there's a sane cap before
  // the first measurement lands) — inline style wins once boardWidth is set.
  const matchBoardWidthStyle = boardWidth ? { maxWidth: boardWidth } : undefined;

  const canRoll = isMyTurn && roomState.turnPhase === "awaiting_roll" && !myPlayer?.autoRollEnabled;
  const canChoosePawn = isMyTurn && roomState.turnPhase === "awaiting_move";
  const playerByColor = new Map(roomState.players.map((p) => [p.color, p]));

  async function handleAction(fn: () => Promise<unknown>) {
    setPending(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof RpcError && err.code === "SESSION_REPLACED") {
        setSessionReplaced();
      } else {
        setActionError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setPending(false);
    }
  }

  function podFor(room: GameRoomState, color: PlayerColor, align: "left" | "right") {
    const player = playerByColor.get(color);
    if (!player) return <div />;
    const isCurrentTurn = room.turnPlayerId === player.id;
    // The turn already moved on, but this player's roll is still within
    // its DICE_HOLD_MS window — keep their dice box up a bit longer
    // instead of it vanishing the instant isCurrentTurn goes false.
    // isCurrentTurn always wins when both are true for the same player
    // (see `value` below) — a bonus-six roller whose held value is their
    // OWN last (already-resolved) roll must still show their fresh,
    // possibly-null awaiting-roll state, not stale pips that'd look like
    // there's nothing left to do.
    const isHeldOnly = !isCurrentTurn && heldRoll?.playerId === player.id;
    // The card's own border/scale follows the same held player, not the
    // real turn — see displayedTurnPlayerId above. turnDeadlineAt is
    // still gated on the REAL isCurrentTurn, not this: room.turnDeadlineAt
    // already belongs to whoever genuinely holds the turn now, so a
    // held-only pod passing it through would show a stranger's countdown
    // under its own avatar. StatusPod already renders no ring at all when
    // turnDeadlineAt is null, which is exactly the "recap, not a timer"
    // look a held pod should have.
    const isDisplayedTurn = displayedTurnPlayerId === player.id;

    const pod = (
      <StatusPod
        player={player}
        pawnCount={pawnCountFor(room, color)}
        isCurrentTurn={isDisplayedTurn}
        turnDeadlineAt={isCurrentTurn ? room.turnDeadlineAt : null}
        isYou={player.id === myPlayerId}
        align={align}
        lastRoll={lastRollByPlayerId[player.id] ?? null}
      />
    );

    // A standalone element next to (not inside) the card, appearing on
    // that player's own turn plus the brief hold window after — see the
    // const above for the exact left/right mapping `align` produces.
    // Wrapped in its own AnimatePresence (not Dice.tsx's own internals)
    // so the box itself fades/pops in and out as it mounts/unmounts
    // instead of an instant swap. What a player last rolled lives
    // permanently on the card too, via StatusPod's `lastRoll` readout —
    // this box is the live roll/roll-control during a turn, and a
    // dimmed, non-interactive recap of it for a few moments after.
    const dice = (
      <AnimatePresence>
        {(isCurrentTurn || isHeldOnly) && (
          <motion.div
            key="dice"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: isHeldOnly ? 0.6 : 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
          >
            <Dice
              value={isCurrentTurn ? room.activeDiceValue : (heldRoll?.value ?? null)}
              playerColor={color}
              size={INLINE_DICE_SIZE}
              // Scoped to "it's genuinely my own turn, and the roll phase" —
              // safe to check here directly: only the pod that is both
              // isCurrentTurn AND mine can ever satisfy canRoll too, so a
              // bot's or opponent's turn (held or not) always renders a
              // plain, non-clickable dice, never a control I could tap on
              // their behalf.
              onRoll={
                canRoll ? () => void handleAction(() => requestRoll(client, roomId, connectionToken)) : undefined
              }
              disabled={pending}
            />
          </motion.div>
        )}
      </AnimatePresence>
    );

    return (
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        {align === "left" ? (
          <>
            {pod}
            {dice}
          </>
        ) : (
          <>
            {dice}
            {pod}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4 p-3 sm:p-4 lg:h-[calc(100vh-2rem)]">
      {/* TOP: Turn Actions — per direct instruction, the right-side Control
          Center column (turn status + Auto-Roll + standings) is gone;
          standings weren't needed and were dropped, and turn status +
          Auto-Roll moved up here, full width, freeing the board to grow
          into the space the column used to take. */}
      <TurnActionsBar
        roomState={roomState}
        myPlayer={myPlayer}
        isMyTurn={isMyTurn}
        canRoll={canRoll}
        canChoosePawn={canChoosePawn}
        actionError={actionError}
        onToggleAutoRoll={(checked) => void handleAction(() => toggleAutoRoll(client, roomId, checked))}
        soundMuted={soundMuted}
        onToggleSound={handleToggleSound}
      />

      <div className="flex flex-1 flex-col gap-4 lg:min-h-0 lg:flex-row">
        {/* LEFT: Match Events */}
        <aside className="hidden w-64 shrink-0 rounded-2xl border border-hairline bg-surface p-3 shadow-elevation-1 xl:flex xl:min-h-0 xl:flex-col">
          <ActivityFeed events={events} players={roomState.players} />
        </aside>

        {/* CENTER: status pods + board — wider now that the right-side
            Control Center column is gone. At lg+ the board's width is
            height-driven (Board.tsx), so the pod rows/banner track its
            actual measured width (matchBoardWidthStyle) rather than a
            static breakpoint; the max-w-* classes are just the
            pre-measurement fallback (and the permanent behavior below lg,
            where the board stays width-driven). */}
        <section className="flex flex-1 flex-col items-center gap-3 overflow-y-auto">
          {sessionReplaced && (
            <div
              role="alert"
              style={matchBoardWidthStyle}
              className="w-full max-w-115 sm:max-w-135 md:max-w-160 rounded-md border border-quadrant-red-border bg-quadrant-red-tint p-2 text-center text-body-sm text-quadrant-red"
            >
              This seat is now controlled from another tab or device.
            </div>
          )}

          {/* flex-col below sm: two ~210px+ pods (avatar + timer slot +
              name/status/roll text, each already at its own practical
              minimum) plus the inline dice box simply don't fit side by
              side in a <400px viewport — they don't wrap, they overflow
              the row, and since the section around them sets
              overflow-y-auto, the CSS spec's "non-visible one axis makes
              visible-on-the-other compute to auto" rule silently makes
              overflow-x auto too, so the excess is clipped/scrollable
              instead of visibly broken — invisibly eating the current
              player's own dice/roll control off to the side. Stacking
              (each pod full width) sidesteps the fit problem entirely
              instead of trying to cram content into less space; per the
              wrapper below, normal page scroll already handles the
              resulting extra height below lg. */}
          <div
            style={matchBoardWidthStyle}
            className="flex w-full max-w-115 sm:max-w-135 md:max-w-160 flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
          >
            {podFor(roomState, QUADRANT_SLOTS[0].color, "left")}
            {podFor(roomState, QUADRANT_SLOTS[1].color, "right")}
          </div>

          {/* This wrapper is what actually fixes "the board needs scrolling
              to see" — at lg+ (where the page height is fixed to the
              viewport) it takes exactly the vertical space left over after
              the pod rows, via flex-1/min-h-0, and Board.tsx sizes itself
              to fit THIS box's shorter dimension instead of always going
              by width. Below lg the page scrolls normally and this is just
              a plain full-width row, unchanged from before. */}
          <div className="flex w-full min-w-0 items-center justify-center lg:min-h-0 lg:flex-1">
            <Board
              boardRef={boardRef}
              roomState={roomState}
              legalPawnIds={legalPawnIds}
              onSelectPawn={(pawnId) => void handleAction(() => requestMove(client, roomId, pawnId, connectionToken))}
            />
          </div>

          <div
            style={matchBoardWidthStyle}
            className="flex w-full max-w-115 sm:max-w-135 md:max-w-160 flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
          >
            {podFor(roomState, QUADRANT_SLOTS[2].color, "left")}
            {podFor(roomState, QUADRANT_SLOTS[3].color, "right")}
          </div>
        </section>
      </div>
    </div>
  );
}

// Replaces the old right-side "Control Center" column — per direct
// instruction, that column (turn status + Auto-Roll + Game Standings) is
// gone; standings weren't needed and were dropped entirely, and this is
// just turn status + Auto-Roll, now a full-width bar at the top of the
// page instead of a sidebar. The dice itself — next to the acting
// player's own name card on the board below — is the roll control; this
// bar is status text only.
function TurnActionsBar({
  roomState,
  myPlayer,
  isMyTurn,
  canRoll,
  canChoosePawn,
  actionError,
  onToggleAutoRoll,
  soundMuted,
  onToggleSound,
}: {
  roomState: GameRoomState;
  myPlayer: Player | null;
  isMyTurn: boolean;
  canRoll: boolean;
  canChoosePawn: boolean;
  actionError: string | null;
  onToggleAutoRoll: (checked: boolean) => void;
  soundMuted: boolean;
  onToggleSound: (muted: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface p-3 shadow-elevation-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="text-body-sm text-text-secondary" aria-live="polite">
        {statusMessage(isMyTurn, canRoll, canChoosePawn, roomState.status)}
      </p>

      <div className="flex shrink-0 items-center gap-3">
        {actionError && (
          <p role="alert" className="text-body-sm text-quadrant-red">
            {actionError}
          </p>
        )}
        {myPlayer && !myPlayer.isBot && (
          <div className="flex items-center gap-2">
            <span className="text-body-sm text-foreground">Auto-Roll</span>
            <label className="ios-switch">
              <input
                type="checkbox"
                checked={myPlayer.autoRollEnabled}
                onChange={(e) => onToggleAutoRoll(e.target.checked)}
              />
              <span className="ios-slider" />
            </label>
          </div>
        )}
        {/* Local playback preference, not a per-player server setting like
            Auto-Roll above — shown unconditionally (even watching a bot
            seat) since it only ever affects sound in THIS browser. */}
        <div className="flex items-center gap-2">
          <span className="text-body-sm text-foreground">Sound</span>
          <label className="ios-switch">
            <input
              type="checkbox"
              checked={!soundMuted}
              aria-label="Sound effects"
              onChange={(e) => onToggleSound(!e.target.checked)}
            />
            <span className="ios-slider" />
          </label>
        </div>
      </div>
    </div>
  );
}

function statusMessage(
  isMyTurn: boolean,
  canRoll: boolean,
  canChoosePawn: boolean,
  status: GameRoomState["status"],
): string {
  if (status !== "in_game") return "";
  if (!isMyTurn) return "Waiting for the current player…";
  if (canRoll) return "Your turn — tap the dice next to your name to roll.";
  if (canChoosePawn) return "Choose a highlighted pawn to move.";
  return "Waiting…";
}
