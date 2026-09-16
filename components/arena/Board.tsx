"use client";

import type { Ref } from "react";
import { useRef, useState } from "react";
import { LayoutGroup, MotionConfig, motion } from "framer-motion";
import { PATH_INDEX, pathIndexToGlobalCell } from "@/lib/board/geometry";
import type { GameRoomState, Pawn, PawnState, PlayerColor } from "@/lib/board/types";
import {
  BASE_AREA,
  GRID_SIZE,
  HOME_LANE_CELLS,
  globalCellToGridPosition,
} from "./boardLayout";
import { BoardArtwork } from "./BoardArtwork";
import { BoardScene3D } from "./BoardScene3D";
import { type GridPoint, trackHopWaypoints } from "./pawnMovePath";

// Every pawn's OWN DOM element (a track cell's wrapper, a nest slot's
// button, whatever's currently rendering it) registers itself here by
// id — BoardScene3D reads this every frame to know where to draw that
// pawn's 3D token, without this file needing to know anything about 3D
// or that file needing to know anything about grid cells, hop paths, or
// FLIP transitions. See the ref={registerPawnAnchor(pawn.id)} calls
// below and BoardScene3D.tsx's own top-of-file comment.
type PawnAnchorRegistry = Map<string, HTMLElement>;
type RegisterPawnAnchor = (pawnId: string) => (el: HTMLElement | null) => void;

interface BoardProps {
  roomState: GameRoomState;
  legalPawnIds: ReadonlySet<string>;
  onSelectPawn: (pawnId: string) => void;
  /**
   * The board's own root element — at lg+ its width is no longer a static
   * Tailwind breakpoint (it's height-driven, see the className below), so
   * the caller can't know it ahead of time. MatchArena measures this ref
   * with a ResizeObserver to keep the status-pod rows the same width as
   * whatever the board actually renders at.
   */
  boardRef?: Ref<HTMLDivElement>;
}

// Every pawn wrapper below carries the SAME layoutId (pawn.id) across four
// structurally different parents (a track cell, a home-lane cell, a nest
// slot, a finished-cluster slot) — Framer's layoutId matches across the
// whole tree regardless of component boundaries, so a pawn changing which
// of those it's rendered in (nest exit, capture back to nest, home-lane
// entry, finishing) animates as a FLIP slide instead of the hard
// teleport/remount it was before. A touch of spring overshoot is what
// gives every arrival — including a capture "bump" back to nest, or a
// pawn finishing — some weight instead of a flat glide-and-stop; there's
// no separate mount-triggered flourish because layoutId transitions never
// unmount, so "on arrival" IS this transition settling.
const PAWN_LAYOUT_TRANSITION = { type: "spring", stiffness: 480, damping: 24 } as const;

// How long each individual hop (one cell to the next) takes while a pawn
// is animating a multi-cell track advance — see the diffing block below
// and HoppingPawn. A 6-cell move (the longest a single die roll can be)
// takes 6 * this.
const HOP_STEP_MS = 170;

type PawnSnapshot = ReadonlyMap<string, { state: PawnState; pathIndex: number | null }>;

function snapshotPawns(pawns: readonly Pawn[]): PawnSnapshot {
  return new Map(pawns.map((p) => [p.id, { state: p.state, pathIndex: p.pathIndex }]));
}

export function Board({ roomState, legalPawnIds, onSelectPawn, boardRef }: BoardProps) {
  // A plain ref (not state) — populated imperatively by DOM ref callbacks
  // below and read imperatively by BoardScene3D every animation frame.
  // Neither side needs a React re-render for this to work, which is the
  // whole point: whatever's ALREADY moving a pawn's real DOM element
  // (Framer Motion's own layoutId FLIP, the hop's keyframe animation)
  // keeps doing exactly that, unaware anything is reading its position.
  const pawnAnchorsRef = useRef<PawnAnchorRegistry>(new Map());
  const boardGridRef = useRef<HTMLDivElement | null>(null);
  // Wraps the (now visually hidden) BoardArtwork SVG — BoardScene3D reads
  // that live DOM node through this ref once, to rasterize it into a
  // texture. See BoardScene3D.tsx's own top-of-file comment for why.
  const boardArtworkWrapperRef = useRef<HTMLDivElement | null>(null);
  function registerPawnAnchor(pawnId: string) {
    return (el: HTMLElement | null) => {
      if (el) pawnAnchorsRef.current.set(pawnId, el);
      else pawnAnchorsRef.current.delete(pawnId);
    };
  }

  // Detects pawns that just started a multi-cell TRACK advance (previous
  // render's pathIndex to this one spans more than one step) so they can
  // hop through the intermediate cells (below) instead of the plain
  // layoutId FLIP every other pawn wrapper uses — FLIP would cut a
  // straight line across the board for a non-adjacent pair. roomState is
  // a full snapshot on every broadcast (no diff info of its own — see
  // lib/store/room-store.ts), so this compares against the PREVIOUS
  // render's own snapshot, kept in state. This is React's documented
  // "adjust state when a prop changes" escape hatch (react.dev — "You
  // Might Not Need an Effect"), not a useEffect: a useEffect would only
  // run after the destination cell had already committed the pawn
  // teleported there, one frame too late to intercept.
  const [prevPawnSnapshot, setPrevPawnSnapshot] = useState<PawnSnapshot | null>(null);
  const [hoppingPawns, setHoppingPawns] = useState<
    ReadonlyMap<string, { color: PlayerColor; waypoints: GridPoint[] }>
  >(new Map());

  const trackPawnsByCell = new Map<number, Pawn[]>();
  // Keyed by the pawn's own stable `index` (0-3, mirrors the DB's
  // pawn_index), NOT array/encounter order — unlike finishedPawnsByColor
  // below, nest pawns are removed from this list (not just added to) as
  // they exit, and removing an entry from the MIDDLE of a plain array
  // shifts every later pawn's array index down. Since NestSlot below used
  // to key each slot by array position, that shift made an untouched
  // sibling pawn's own layoutId FLIP-slide into the vacated slot — a
  // pawn that never left the nest visibly "jumping" there instead of the
  // pawn that actually did. A 4-slot array indexed by pawn.index directly
  // means a slot's occupant only ever changes for that exact pawn.
  const nestPawnsByColor = new Map<PlayerColor, (Pawn | undefined)[]>();
  // Keyed by `${color}-${homeIndex}` (homeIndex 0-4, one of HOME_LANE_CELLS'
  // 5 cells for that color) — a pawn's pathIndex maps to exactly one
  // homeIndex the same way it maps to exactly one global track cell, and
  // same-color pawns can share a cell here too (no-blockade rule applies
  // in the home lane the same as the shared track), so this stacks the
  // same way trackPawnsByCell does.
  const homeLanePawnsByKey = new Map<string, Pawn[]>();
  // Order-stable (roomState.pawns' own order, i.e. by pawn.index) so a
  // given pawn keeps the same finish slot as more of its color finish —
  // safe as a plain append-only array (unlike nestPawnsByColor above)
  // because a finished pawn never leaves the finished state, so nothing
  // is ever removed from the middle to reshuffle it.
  const finishedPawnsByColor = new Map<PlayerColor, Pawn[]>();

  for (const pawn of roomState.pawns) {
    if (pawn.state === "track" && pawn.pathIndex !== null) {
      const globalCell = pathIndexToGlobalCell(pawn.color, pawn.pathIndex);
      const list = trackPawnsByCell.get(globalCell) ?? [];
      list.push(pawn);
      trackPawnsByCell.set(globalCell, list);
    } else if (pawn.state === "nest") {
      const list = nestPawnsByColor.get(pawn.color) ?? [undefined, undefined, undefined, undefined];
      list[pawn.index] = pawn;
      nestPawnsByColor.set(pawn.color, list);
    } else if (pawn.state === "home_lane" && pawn.pathIndex !== null) {
      const key = `${pawn.color}-${pawn.pathIndex - PATH_INDEX.HOME_LANE_START}`;
      const list = homeLanePawnsByKey.get(key) ?? [];
      list.push(pawn);
      homeLanePawnsByKey.set(key, list);
    } else if (pawn.state === "finished") {
      const list = finishedPawnsByColor.get(pawn.color) ?? [];
      list.push(pawn);
      finishedPawnsByColor.set(pawn.color, list);
    }
  }

  const currentPawnSnapshot = snapshotPawns(roomState.pawns);
  const snapshotChanged =
    prevPawnSnapshot === null ||
    currentPawnSnapshot.size !== prevPawnSnapshot.size ||
    [...currentPawnSnapshot].some(([id, current]) => {
      const prev = prevPawnSnapshot.get(id);
      return !prev || prev.state !== current.state || prev.pathIndex !== current.pathIndex;
    });

  if (snapshotChanged) {
    // Only ever ADDS entries here — a hop is removed from hoppingPawns by
    // HoppingPawn's own onAnimationComplete callback once it's actually
    // finished playing, not by this diff (which runs once per broadcast,
    // long before a multi-second hop sequence is done).
    const nextHoppingPawns = new Map(hoppingPawns);
    let addedHop = false;
    if (prevPawnSnapshot) {
      for (const pawn of roomState.pawns) {
        const prev = prevPawnSnapshot.get(pawn.id);
        if (
          prev?.state !== "track" ||
          pawn.state !== "track" ||
          prev.pathIndex === null ||
          pawn.pathIndex === null ||
          pawn.pathIndex - prev.pathIndex <= 1 ||
          hoppingPawns.has(pawn.id)
        ) {
          continue;
        }
        // Skip the custom hop if the destination will end up with 2+
        // pawns: the hop's own landing position doesn't know about the
        // "-ml-[46%]" stacking offset the destination cell would apply
        // to a non-first pawn, so it'd land slightly off from where the
        // static render puts it. Rare (landing deliberately on your own
        // color), and a plain FLIP there still looks correct, just
        // straight instead of curved.
        const destinationGlobalCell = pathIndexToGlobalCell(pawn.color, pawn.pathIndex);
        if ((trackPawnsByCell.get(destinationGlobalCell)?.length ?? 0) > 1) continue;

        const originCell = globalCellToGridPosition(pathIndexToGlobalCell(pawn.color, prev.pathIndex));
        nextHoppingPawns.set(pawn.id, {
          color: pawn.color,
          waypoints: [originCell, ...trackHopWaypoints(pawn.color, prev.pathIndex, pawn.pathIndex)],
        });
        addedHop = true;
      }
    }
    setPrevPawnSnapshot(currentPawnSnapshot);
    if (addedHop) setHoppingPawns(nextHoppingPawns);
  }

  const cells = [];
  for (let i = 0; i <= 51; i++) {
    const { row, col } = globalCellToGridPosition(i);
    // A hopping pawn is drawn by the HoppingPawn overlay below instead —
    // rendering it here too, mid-hop, would show it twice.
    const pawnsHere = (trackPawnsByCell.get(i) ?? []).filter((p) => !hoppingPawns.has(p.id));
    cells.push(
      <div
        key={`cell-${i}`}
        className="flex items-center justify-center"
        style={{ gridRow: row + 1, gridColumn: col + 1, zIndex: 4 }}
      >
        <div className="flex h-full w-full items-center justify-center">
          {pawnsHere.map((pawn, i) => (
            <motion.div
              key={pawn.id}
              ref={registerPawnAnchor(pawn.id)}
              layout
              layoutId={pawn.id}
              transition={PAWN_LAYOUT_TRANSITION}
              className={`relative flex h-[78%] w-[78%] items-center justify-center ${
                i > 0 ? "-ml-[46%]" : ""
              }`}
              style={{ zIndex: i }}
            >
              <PawnToken
                color={pawn.color}
                isLegal={legalPawnIds.has(pawn.id)}
                onClick={() => onSelectPawn(pawn.id)}
                variant="track"
              />
            </motion.div>
          ))}
        </div>
      </div>,
    );
  }

  const homeLaneCells = (Object.keys(HOME_LANE_CELLS) as PlayerColor[]).flatMap((color) =>
    HOME_LANE_CELLS[color].map(([row, col], homeIndex) => {
      const pawnsHere = homeLanePawnsByKey.get(`${color}-${homeIndex}`) ?? [];
      return (
        <div
          key={`home-${color}-${homeIndex}`}
          className="flex items-center justify-center"
          style={{ gridRow: row + 1, gridColumn: col + 1, zIndex: 4 }}
        >
          <div className="flex h-full w-full items-center justify-center">
            {pawnsHere.map((pawn, i) => (
              <motion.div
                key={pawn.id}
                ref={registerPawnAnchor(pawn.id)}
                layout
                layoutId={pawn.id}
                transition={PAWN_LAYOUT_TRANSITION}
                className={`relative flex h-[78%] w-[78%] items-center justify-center ${
                  i > 0 ? "-ml-[46%]" : ""
                }`}
                style={{ zIndex: i }}
              >
                <PawnToken
                  color={pawn.color}
                  isLegal={legalPawnIds.has(pawn.id)}
                  onClick={() => onSelectPawn(pawn.id)}
                  variant="track"
                />
              </motion.div>
            ))}
          </div>
        </div>
      );
    }),
  );

  return (
    <div
      ref={boardRef}
      // aspect-4/3: at lg+ this wrapper is height-driven (lg:h-full) —
      // measured live, it was actually using 100% of its available
      // height but only ~44% of its available width (624px tall, but
      // only 499px of a possible 1136px wide), because aspect-4/5 (taller
      // than wide) converts a fixed height budget into a narrow width.
      // Flipping to wider-than-tall turns that same unused width into a
      // dramatically bigger board for the exact same height — and, as a
      // bonus, eases the camera's framing job too, since a landscape
      // container needs less vertical margin to show the board receding
      // into the distance without cropping than a portrait one did.
      className="relative mx-auto aspect-4/3 w-full max-w-150 border border-outline/55 bg-surface p-3 shadow-elevation-2 sm:max-w-180 sm:p-5 md:max-w-220 lg:h-full lg:w-auto lg:max-w-full"
    >
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <div
            data-board-grid
            ref={boardGridRef}
            // opacity-0 (not display:none, which would zero out every
            // getBoundingClientRect() BoardScene3D reads): this grid is
            // now a purely invisible logic substrate — real Framer Motion
            // layoutId FLIP/hop animation, real click targets (rendered
            // pointer-events-none, see NestSlot/PawnToken below), still
            // fully live, just never seen. absolute inset-0 (not the old
            // aspect-square + w-full sizing): its own on-screen shape no
            // longer needs to visually match the 3D render at all, since
            // BoardScene3D only ever reads FRACTIONAL (0..1) positions
            // from it, which are meaningful regardless of this box's own
            // aspect ratio.
            className="absolute inset-0 grid overflow-hidden bg-surface opacity-0"
            style={{
              gridTemplateRows: `repeat(${GRID_SIZE}, 1fr)`,
              gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
            }}
          >
            {/* Kept mounted, never visible — BoardScene3D rasterizes this
                exact SVG once (see its own top comment) and maps it onto
                the 3D slab's top face instead of this rendering directly.
                Forced activeColor=null: this instance must stay a clean,
                highlight-free snapshot, since a one-time raster can't
                carry that pulsing animation — BoardScene3D rebuilds the
                active-turn highlight itself as a live 3D overlay. */}
            <div ref={boardArtworkWrapperRef}>
              <BoardArtwork activeColor={null} />
            </div>

            {(Object.keys(BASE_AREA) as PlayerColor[]).map((color) => (
              <BaseQuadrantHitArea
                key={color}
                color={color}
                pawns={nestPawnsByColor.get(color) ?? []}
                legalPawnIds={legalPawnIds}
                onSelectPawn={onSelectPawn}
                registerPawnAnchor={registerPawnAnchor}
              />
            ))}

            {cells}
            {homeLaneCells}

            {(Object.keys(FINISH_SLOT_POSITIONS) as PlayerColor[]).map((color) => (
              <FinishedPawnCluster
                key={color}
                color={color}
                pawns={finishedPawnsByColor.get(color) ?? []}
                registerPawnAnchor={registerPawnAnchor}
              />
            ))}

            {[...hoppingPawns].map(([pawnId, { color, waypoints }]) => (
              <HoppingPawn
                key={pawnId}
                pawnId={pawnId}
                color={color}
                waypoints={waypoints}
                isLegal={legalPawnIds.has(pawnId)}
                onSelectPawn={() => onSelectPawn(pawnId)}
                registerPawnAnchor={registerPawnAnchor}
                onDone={() =>
                  setHoppingPawns((prev) => {
                    if (!prev.has(pawnId)) return prev;
                    const next = new Map(prev);
                    next.delete(pawnId);
                    return next;
                  })
                }
              />
            ))}
          </div>
        </LayoutGroup>
      </MotionConfig>

      {/* A sibling of data-board-grid, not a child: data-board-grid has
          overflow-hidden and a shape that no longer matches the outer
          wrapper's own (BoardScene3D needs the full, taller wrapper box
          to show its angled camera's view without clipping). */}
      <BoardScene3D
        svgWrapperRef={boardArtworkWrapperRef}
        activeColor={roomState.players.find((p) => p.id === roomState.turnPlayerId)?.color ?? null}
        pawns={roomState.pawns}
        legalPawnIds={legalPawnIds}
        anchorsRef={pawnAnchorsRef}
        containerRef={boardGridRef}
        onSelectPawn={onSelectPawn}
      />
    </div>
  );
}

// The 4 parking-spot positions, fixed relative to each base quadrant's own
// box (independent of color) — close to the true corners, matching the
// reference's corner-parked pawns-on-star-badges.
const NEST_SLOT_POSITIONS: Record<PlayerColor, readonly (readonly [number, number])[]> = {
  red: [
    [10.52, 10.726],
    [89.728, 10.726],
    [11.345, 88.903],
    [89.315, 88.903],
  ],
  green: [
    [9.86, 10.932],
    [88.243, 11.345],
    [10.685, 88.903],
    [88.243, 88.903],
  ],
  yellow: [
    [10.479, 10.479],
    [88.861, 9.86],
    [10.685, 88.243],
    [88.243, 88.243],
  ],
  blue: [
    [10.52, 9.86],
    [89.109, 10.479],
    [11.345, 88.243],
    [89.728, 88.655],
  ],
};

// The 4 "home pile" slots per color, inside that color's own center
// pinwheel wedge — pawns in the "finished" state (pathIndex 56) were
// computed but never actually rendered anywhere before, so a pawn that
// completed the board just vanished. Two rows of two, straddling that
// wedge's own star badge (CENTER_WEDGES in BoardArtwork.tsx) — some
// visual overlap with the star is expected/fine (real Ludo boards pile
// finished pawns right on top of the home decoration), spaced roughly a
// pawn-diameter apart so up to 4 in the same wedge don't overlap each
// other. Board-grid units (0-15), same space as everything else on this
// board, not percentages — converted in FinishedPawnCluster below.
const FINISH_SLOT_POSITIONS: Record<PlayerColor, readonly (readonly [number, number])[]> = {
  green: [
    [7.1, 6.95],
    [7.9, 6.95],
    [7.1, 6.35],
    [7.9, 6.35],
  ],
  yellow: [
    [8.05, 7.1],
    [8.05, 7.9],
    [8.65, 7.1],
    [8.65, 7.9],
  ],
  blue: [
    [7.1, 8.05],
    [7.9, 8.05],
    [7.1, 8.65],
    [7.9, 8.65],
  ],
  red: [
    [6.95, 7.1],
    [6.95, 7.9],
    [6.35, 7.1],
    [6.35, 7.9],
  ],
};

// Absolutely positioned (not a grid item, unlike track/home-lane cells) —
// FINISH_SLOT_POSITIONS' coordinates don't land on integer grid lines, so
// this converts them to percentages of the whole board instead of using
// gridRow/gridColumn placement.
function FinishedPawnCluster({
  color,
  pawns,
  registerPawnAnchor,
}: {
  color: PlayerColor;
  pawns: Pawn[];
  registerPawnAnchor: RegisterPawnAnchor;
}) {
  return (
    <>
      {FINISH_SLOT_POSITIONS[color].map(([col, row], i) => {
        const pawn = pawns[i];
        if (!pawn) return null;
        return (
          <motion.div
            key={pawn.id}
            ref={registerPawnAnchor(pawn.id)}
            layout
            layoutId={pawn.id}
            transition={PAWN_LAYOUT_TRANSITION}
            className="absolute"
            style={{
              left: `${(col / GRID_SIZE) * 100}%`,
              top: `${(row / GRID_SIZE) * 100}%`,
              width: `${((1 / GRID_SIZE) * 100 * 0.78).toFixed(3)}%`,
              height: `${((1 / GRID_SIZE) * 100 * 0.78).toFixed(3)}%`,
              // Centers the box on (left, top) — via framer's own x/y motion
              // values, NOT a CSS `-translate-x-1/2` class: that class sets
              // the same `transform` property framer's layout animation
              // drives directly, and framer's inline style would win,
              // silently dropping the centering offset the instant this
              // element becomes layout-animated.
              x: "-50%",
              y: "-50%",
              zIndex: 5,
            }}
          >
            <PawnToken color={color} isLegal={false} onClick={onSelectPawnNoop} variant="track" />
          </motion.div>
        );
      })}
    </>
  );
}

// The one case plain layoutId FLIP isn't used for — a multi-cell TRACK
// advance. `waypoints` is the full path INCLUDING the pawn's starting
// cell (index 0) through its destination (last), computed once by the
// diffing block in Board.tsx. Deliberately no layoutId here: mixing
// layoutId's own transform-based FLIP with an explicit left/top keyframe
// `animate` on the same element risks the two positioning systems
// fighting each other. Instead this relies on `waypoints`' last entry
// resolving to the EXACT same coordinates the static grid cell would
// (same globalCellToGridPosition math either way), so handing back off
// to normal grid rendering once `onDone` fires is seamless without needing
// FLIP continuity.
function HoppingPawn({
  pawnId,
  color,
  waypoints,
  isLegal,
  onSelectPawn,
  registerPawnAnchor,
  onDone,
}: {
  pawnId: string;
  color: PlayerColor;
  waypoints: GridPoint[];
  isLegal: boolean;
  onSelectPawn: () => void;
  registerPawnAnchor: RegisterPawnAnchor;
  onDone: () => void;
}) {
  // +0.5: waypoints are raw grid cell indices (the same ones gridRow/
  // gridColumn use for static placement), but a static cell's pawn sits
  // at that cell's CENTER — CSS Grid places the (row+1)-th 1fr track from
  // row/GRID_SIZE to (row+1)/GRID_SIZE, and `items-center justify-center`
  // centers within it, i.e. at (row+0.5)/GRID_SIZE. Without this offset
  // every waypoint here landed a full half-cell up-and-left of where the
  // cell actually is, so the hop visibly cut across the board off-track
  // and then snapped half a cell over the instant onDone handed back to
  // normal grid rendering (whose math this now matches exactly).
  const lefts = waypoints.map((w) => `${((w.col + 0.5) / GRID_SIZE) * 100}%`);
  const tops = waypoints.map((w) => `${((w.row + 0.5) / GRID_SIZE) * 100}%`);
  const hopCount = waypoints.length - 1;

  return (
    <motion.div
      ref={registerPawnAnchor(pawnId)}
      className="absolute"
      style={{
        width: `${((1 / GRID_SIZE) * 100 * 0.78).toFixed(3)}%`,
        height: `${((1 / GRID_SIZE) * 100 * 0.78).toFixed(3)}%`,
        x: "-50%",
        y: "-50%",
        zIndex: 5,
      }}
      initial={{ left: lefts[0], top: tops[0] }}
      animate={{ left: lefts, top: tops }}
      // `ease` (given a single, non-array value) applies to EVERY segment
      // of a keyframe array individually, not once across the whole
      // sequence — an easeInOut here meant each individual ~170ms hop
      // decelerated and reaccelerated, so a multi-cell move read as a
      // rapid stutter instead of one fluid glide. `linear` per segment
      // composes into one continuous constant-speed run across however
      // many cells, which is what "hopping along the track" should
      // actually look like.
      transition={{ duration: (hopCount * HOP_STEP_MS) / 1000, ease: "linear" }}
      onAnimationComplete={onDone}
    >
      <PawnToken color={color} isLegal={isLegal} onClick={onSelectPawn} variant="track" />
    </motion.div>
  );
}

// Finished pawns are never a legal move target (PRD/rules.test.ts: "finished
// pawns never appear in legal moves again"), so PawnToken's button is always
// disabled here regardless — this exists only because PawnToken's onClick
// prop is required, not because it can ever actually fire.
function onSelectPawnNoop() {}

// Transparent hit areas aligned over the printed nest slots in the board
// texture. The artwork supplies the visible star badges; this layer only
// preserves interactivity.
function BaseQuadrantHitArea({
  color,
  pawns,
  legalPawnIds,
  onSelectPawn,
  registerPawnAnchor,
}: {
  color: PlayerColor;
  pawns: (Pawn | undefined)[];
  legalPawnIds: ReadonlySet<string>;
  onSelectPawn: (pawnId: string) => void;
  registerPawnAnchor: RegisterPawnAnchor;
}) {
  const area = BASE_AREA[color];

  return (
    <div
      className="relative"
      style={{
        gridRow: `${area.rowStart + 1} / span ${area.rowEnd - area.rowStart + 1}`,
        gridColumn: `${area.colStart + 1} / span ${area.colEnd - area.colStart + 1}`,
        zIndex: 3,
      }}
    >
      {NEST_SLOT_POSITIONS[color].map(([left, top], i) => {
        const pawn = pawns[i];
        return (
          <div
            key={i}
            data-nest-slot={`${color}-${i}`}
            className="absolute flex h-[16%] w-[16%] -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${left}%`, top: `${top}%` }}
          >
            <NestSlot
              color={color}
              pawn={pawn}
              isLegal={pawn ? legalPawnIds.has(pawn.id) : false}
              onSelectPawn={onSelectPawn}
              registerPawnAnchor={registerPawnAnchor}
            />
          </div>
        );
      })}
    </div>
  );
}

function NestSlot({
  color,
  pawn,
  isLegal,
  onSelectPawn,
  registerPawnAnchor,
}: {
  color: PlayerColor;
  pawn: Pawn | undefined;
  isLegal: boolean;
  onSelectPawn: (pawnId: string) => void;
  registerPawnAnchor: RegisterPawnAnchor;
}) {
  if (!pawn) {
    return (
      <div className="relative flex h-full w-full items-center justify-center" />
    );
  }

  return (
    <motion.button
      ref={registerPawnAnchor(pawn.id)}
      type="button"
      layout
      layoutId={pawn.id}
      transition={PAWN_LAYOUT_TRANSITION}
      onClick={isLegal ? () => onSelectPawn(pawn.id) : undefined}
      disabled={!isLegal}
      aria-label={`${color} pawn in nest${isLegal ? " — legal move, tap to select" : ""}`}
      // pointer-events-none: BoardScene3D's own meshes are the actual click
      // surface now (raycasting under its angled camera) — this DOM button
      // stays fully live for Framer Motion's layoutId FLIP/hop animation
      // (which is what BoardScene3D reads positions from every frame) and
      // for its onClick/disabled/aria-label, it just can't intercept a
      // click meant for the 3D token sitting visually on top of it.
      className="relative flex h-full w-full items-center justify-center rounded-full pointer-events-none"
    >
      <PieceFace color={color} isLegal={isLegal} variant="nest" />
    </motion.button>
  );
}

// Translucent glass pawn tokens. A legal, tappable pawn pulses with the
// reference's turn-ring glow.
function PawnToken({
  color,
  isLegal,
  onClick,
  variant,
}: {
  color: PlayerColor;
  isLegal: boolean;
  onClick: () => void;
  variant: "track" | "nest";
}) {
  return (
    <button
      type="button"
      onClick={isLegal ? onClick : undefined}
      disabled={!isLegal}
      aria-label={`${color} pawn${isLegal ? " — legal move, tap to select" : ""}`}
      // pointer-events-none: see the matching comment on NestSlot's button
      // above — BoardScene3D's meshes are the click surface now.
      className="relative flex h-full w-full shrink-0 items-center justify-center rounded-full pointer-events-none"
    >
      <PieceFace color={color} isLegal={isLegal} variant={variant} />
    </button>
  );
}

function PieceFace({
  color,
  isLegal,
  variant,
}: {
  color: PlayerColor;
  isLegal: boolean;
  variant: "track" | "nest";
}) {
  return (
    <span
      className={`ludo-piece ludo-piece-3d-hidden ludo-piece-${color} ${
        variant === "nest" ? "ludo-piece-nest" : "ludo-piece-track"
      } ${isLegal ? "ludo-piece-legal" : ""}`}
      aria-hidden
    />
  );
}
