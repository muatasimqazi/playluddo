"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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

export function MatchArena({ client, roomId }: MatchArenaProps) {
  const roomState = useRoomStore((s) => s.roomState);
  const events = useRoomStore((s) => s.events);
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const connectionToken = useRoomStore((s) => s.connectionToken);
  const setSessionReplaced = useRoomStore((s) => s.setSessionReplaced);
  const sessionReplaced = useRoomStore((s) => s.sessionReplaced);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

    const pod = (
      <StatusPod
        player={player}
        pawnCount={pawnCountFor(room, color)}
        isCurrentTurn={isCurrentTurn}
        turnDeadlineAt={room.turnDeadlineAt}
        isYou={player.id === myPlayerId}
        align={align}
        lastRoll={lastRollByPlayerId[player.id] ?? null}
      />
    );

    // A standalone element next to (not inside) the card, appearing only
    // on that player's own turn — see the const above for the exact
    // left/right mapping `align` produces. Wrapped in its own
    // AnimatePresence (not Dice.tsx's own internals) so the box itself
    // fades/pops in and out as it mounts/unmounts instead of an instant
    // swap. What a player last rolled, even after their turn ends, lives
    // on the card itself via StatusPod's permanent `lastRoll` readout —
    // this box is only ever the current player's own roll/roll-control.
    const dice = (
      <AnimatePresence>
        {isCurrentTurn && (
          <motion.div
            key="dice"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
          >
            <Dice
              value={room.activeDiceValue}
              playerColor={color}
              size={INLINE_DICE_SIZE}
              // Scoped to "it's genuinely my own turn, and the roll phase" —
              // safe to check here directly: only the pod that is both
              // isCurrentTurn AND mine can ever satisfy canRoll too, so a
              // bot's or opponent's turn always renders a plain,
              // non-clickable dice, never a control I could tap on their
              // behalf.
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
      <div className="flex min-w-0 items-center gap-2">
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

          <div
            style={matchBoardWidthStyle}
            className="flex w-full max-w-115 sm:max-w-135 md:max-w-160 items-center justify-between gap-2"
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
            className="flex w-full max-w-115 sm:max-w-135 md:max-w-160 items-center justify-between gap-2"
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
}: {
  roomState: GameRoomState;
  myPlayer: Player | null;
  isMyTurn: boolean;
  canRoll: boolean;
  canChoosePawn: boolean;
  actionError: string | null;
  onToggleAutoRoll: (checked: boolean) => void;
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
