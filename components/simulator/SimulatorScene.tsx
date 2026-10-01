"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Canvas,
  useFrame,
  useLoader,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  Billboard,
  CameraControls,
  CameraControlsImpl,
  ContactShadows,
  Environment,
  Html,
  Lightformer,
  PerformanceMonitor,
  RoundedBox,
  useProgress,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { hapticTap, useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import type { GameType, Pawn, Player, PlayerColor } from "@/lib/board/types";
import { BOARD_4, boardSpecForColors, type BoardSpec } from "@/lib/board/boardSpec";
import { tileIdToPathIndex } from "@/lib/board/geometry";
import { snakesLayout } from "@/lib/board/snakes";
import { BASE_AREA } from "@/components/arena/boardLayout";
import {
  BOARD_SIZE,
  BOARD_Y,
  CELL,
  HOP_MS,
  gridPoint,
  ROLL_MS,
  moveWaypoints,
  pawnPoint,
  pieceScale,
  rotationStep,
  shortestAngle,
  snakeSquarePoint,
  type ActionCamera,
  type CameraView,
  type InteractionMode,
  type Point,
  type Quality,
} from "@/lib/presentation/board";
import type { PresentationFrame } from "@/lib/presentation/timeline";
import { cameraFraming } from "@/lib/presentation/camera";
import type { HexBoardStyle } from "@/lib/presentation/hexArtwork";
import {
  HEX_ART_RADIUS,
  HEX_BASE_RADIUS,
  HEX_SLAB_APOTHEM,
  hexBaseAngle,
  hexBaseCenter,
  hexPolar,
  hexSeatPoint,
} from "@/lib/presentation/hexBoard";
import boardArtwork from "@/designs/board-design.webp";
import classicBoardArtwork from "@/designs/board-classic.svg";
import geometricBoardArtwork from "@/designs/board-geometric.svg";
import aladdinBoardArtwork from "@/designs/board-aladdin.svg";
// The 5-6 player hexagon in each board style (F5.2); lib/presentation/hexArtwork.ts.
import hexClassicArtwork from "@/designs/board-hex-classic.svg";
import hexSignatureArtwork from "@/designs/board-hex-signature.svg";
import hexGeometricArtwork from "@/designs/board-hex-geometric.svg";
import hexAladdinArtwork from "@/designs/board-hex-aladdin.svg";
import lampArtwork from "@/designs/lamp.svg";
import snakeArtwork from "@/designs/snake-and-ladder/snakes-and-ladders-board.svg";
import snakeArtwork2 from "@/designs/snake-and-ladder/snakes-and-ladders-board-2.svg";
import {
  makeBoardTexture,
  makeNameTexture,
  makeTongueTexture,
  SeatRecolorLoader,
} from "./textures";
import { SeatSymbolMark } from "./SeatSymbolMark";
import { SeatSymbol } from "@/components/shared/SeatSymbol";
import { SEAT_SYMBOLS, seatColors } from "@/lib/presentation/accessibility";
import { Apartment } from "./Apartment";
import { MahoganyRoom } from "./MahoganyRoom";
import { CafeRoom } from "./CafeRoom";
import { LakeCabin } from "./LakeCabin";
import type { RoomStyle } from "@/lib/presentation/simulatorPrefs";
import { GlassPawn, GLASS_PAWN_HEIGHT } from "./GlassPawn";
import { ClassicPawn, CLASSIC_PAWN_HEIGHT } from "./ClassicPawn";
import { AladdinPawn, ALADDIN_PAWN_HEIGHT } from "./AladdinPawn";
import { Icon } from "./Icon";
import { PlayerAvatars3D } from "./PlayerAvatar3D";
import { TableLoading } from "./TableLoading";
import { playSoundEffect } from "@/lib/sound/effects";
import { isPhrase } from "@/lib/realtime/reactions";

export interface SceneProps {
  gameType?: GameType;
  frame: PresentationFrame;
  players: Player[];
  myPlayerId: string | null;
  turnPlayerId: string | null;
  legalPawnIds: string[];
  canRoll: boolean;
  view: CameraView;
  mode: InteractionMode;
  orientation: number;
  quality: Quality;
  actionCamera: ActionCamera;
  resetKey: number;
  onRotate: (angle: number) => void;
  onRoll: () => void;
  onMove: (id: string) => void;
  reactions?: Record<string, string>;
  speakingPlayerIds?: Set<string>;
  preview?: boolean;
  soundEnabled?: boolean;
  boardStyle?: "signature" | "classic" | "geometric" | "aladdin";
  /** The room around the table. Apartment unless the player picked another. */
  room?: RoomStyle;
  /** Snakes & Ladders (F2.6): which printed board — 0 (default) or 1. */
  snakesBoard?: number;
  hideLabels?: boolean;
  brightness?: number;
  saturation?: number;
  /**
   * Party Mode's shared screen (docs/COMPETITIVE_ROADMAP.md P1): a passive
   * TV display nobody plays from. Camera orbit and board-spin are locked so a
   * stray touch or click can't knock the view askew with no on-screen control
   * to put it back.
   */
  screen?: boolean;
  /** Matches the page's own `dynamic()` loading label so the text doesn't change mid-load. */
  loadingLabel?: string;
  /**
   * "Colour-blind mode" (F5.5): the alternative seat palette, the board
   * artwork recoloured to match, and symbols on pawns and bases.
   */
  colorBlind?: boolean;
  /**
   * F5.5: no camera glides, pawn hops, tumbling die, board spins or idle
   * sway. The device setting or the player's own choice (useReducedMotion).
   */
  reducedMotion?: boolean;
  /** The piece a keyboard user has focused in the piece list, shown lifted like a hover. */
  focusedPawnId?: string | null;
  /** Remote cameras on cards above the seat figures (Section 7, V3), by player id. */
  videoStreams?: Map<string, MediaStream>;
  /** A video card was tapped. */
  onVideoSelect?: (playerId: string) => void;
  /** The frame rate stayed low with video cards up: the table should fall back to the 2D strip. */
  onVideoSlow?: () => void;
}

function CameraRig({
  view,
  mode,
  resetKey,
  actionCamera,
  frame,
  preview,
  screen,
  reducedMotion,
  room,
}: SceneProps) {
  const controls = useRef<CameraControlsImpl>(null);
  // The very first setLookAt below should snap into place, not glide —
  // the Canvas's initial camera (see the camera prop) is already seeded
  // from this same framing, so animating it would only fight a mismatch
  // between window-based and canvas-based aspect at mount.
  const firstFraming = useRef(true);
  const { size, camera } = useThree();
  const aspect = size.width / size.height;
  const mobile = aspect < 0.9;
  const coarse = useCoarsePointer();
  // Reduced motion keeps the camera where it is through rolls and moves.
  const cinematic =
    !reducedMotion && actionCamera === "cinematic" && frame.busy && mode === "play";
  const subtle =
    !reducedMotion && actionCamera === "subtle" && frame.busy && mode === "play";
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      // eslint-disable-next-line react-hooks/immutability -- R3F owns a mutable Three camera, not immutable React state.
      camera.fov = cameraFraming(view, aspect, preview).fov;
      camera.updateProjectionMatrix();
    }
  }, [camera, view, aspect, preview]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.setBoundary(
      new THREE.Box3(
        new THREE.Vector3(-1.4, -0.1, -1.4),
        new THREE.Vector3(1.4, 1.6, 1.4),
      ),
    );
  }, []);
  // The full-table view orbits out to the walls. The Apartment's window wall
  // is glass, so passing it just shows the city; the other rooms' walls are
  // solid, with fireplaces, shelves and counters standing proud of them, so
  // there the camera is pulled in to stay in front of them.
  const roomColliders = useMemo(() => {
    const material = new THREE.MeshBasicMaterial();
    const walls: [THREE.Vector3Tuple, THREE.Vector3Tuple][] = [
      [[0, 6, -12.6], [27, 17, 0.5]],
      [[0, 6, 13.3], [27, 17, 0.4]],
      [[12.45, 6, 0], [0.5, 17, 28]],
      [[-12.95, 6, 0], [0.5, 17, 28]],
    ];
    return walls.map(([position, size]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      wall.position.set(...position);
      wall.updateMatrixWorld();
      return wall;
    });
  }, []);
  useEffect(
    () => () => {
      roomColliders.forEach((wall) => wall.geometry.dispose());
      (roomColliders[0].material as THREE.Material).dispose();
    },
    [roomColliders],
  );
  useEffect(() => {
    const c = controls.current;
    if (c) c.colliderMeshes = room && room !== "apartment" ? roomColliders : [];
  }, [room, roomColliders]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (mode === "rotate") {
      c.stop();
      return;
    }
    if (mode === "look") return;
    const framing = cameraFraming(view, aspect, preview);
    let eye = framing.eye;
    if (cinematic && !mobile) eye = [eye[0] + 1.1, eye[1] + 0.2, eye[2] - 0.45];
    else if (subtle && !mobile)
      eye = [eye[0] + 0.12, eye[1] + 0.1, eye[2] - 0.1];
    // Under reduced motion a new view cuts straight there instead of gliding.
    const animate = !firstFraming.current && !reducedMotion;
    firstFraming.current = false;
    void c.setLookAt(...eye, ...framing.target, animate);
  }, [view, mode, resetKey, mobile, aspect, cinematic, subtle, preview, reducedMotion]);
  const { ACTION } = CameraControlsImpl;
  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.48}
      draggingSmoothTime={0.15}
      minDistance={6.5}
      maxDistance={
        mode === "look"
          ? 12
          : preview || view === "table"
            ? 17
            : mobile
              ? 13
              : 12
      }
      minPolarAngle={0.01}
      maxPolarAngle={Math.PI * 0.45}
      boundaryEnclosesCamera={false}
      mouseButtons={
        // The party screen is a passive display with no controls to reset a
        // nudged camera — freeze it so a stray click can't move the view.
        screen
          ? { left: ACTION.NONE, middle: ACTION.NONE, right: ACTION.NONE, wheel: ACTION.NONE }
          : {
              // Orbiting and zooming work immediately, without switching into
              // Look mode first — only the board-spin gesture (right mouse
              // button, freed up here so BoardObject can claim it in "play")
              // and screen-pan stay behind the explicit Look mode.
              left: mode === "rotate" ? ACTION.NONE : ACTION.ROTATE,
              middle: mode === "look" ? ACTION.DOLLY : ACTION.NONE,
              right: mode === "look" ? ACTION.TRUCK : ACTION.NONE,
              wheel: ACTION.DOLLY,
            }
      }
      touches={
        screen
          ? { one: ACTION.NONE, two: ACTION.NONE, three: ACTION.NONE }
          : {
              // One finger drags the view in play too — that's how the table reads
              // as 3D, and how the phone overhead view reveals the room around it
              // (see Surroundings). Taps stay safe: pawns and the die ignore a
              // press that turned into a drag (TAP_SLOP_PX). On phones, pinch also
              // zooms in on small cells.
              one: mode === "rotate" ? ACTION.NONE : ACTION.TOUCH_ROTATE,
              two:
                mode === "look" || (coarse && mode === "play")
                  ? ACTION.TOUCH_DOLLY_TRUCK
                  : ACTION.NONE,
              three: ACTION.NONE,
            }
      }
    />
  );
}

type BoardStyle = "signature" | "classic" | "geometric" | "aladdin";

// The signature artwork (designs/board-design.webp) prints its base nest
// circles at ~9.6% / ~90.4% of each quadrant — closer to the corners than
// the shared NEST_SLOT_POSITIONS, which match the classic/geometric/aladdin
// artworks. Slot order matches those: 0 top-left, 1 top-right, 2 bottom-left,
// 3 bottom-right.
const SIGNATURE_NEST_LO = 9.6;
const SIGNATURE_NEST_HI = 90.4;

/** pawnPoint, with parked pieces moved onto the signature board's own nest circles. */
function simPawnPoint(
  pawn: Pawn,
  gameType: GameType,
  spec: BoardSpec,
  boardStyle: BoardStyle,
): Point {
  if (
    boardStyle !== "signature" ||
    gameType !== "ludo" ||
    spec.arms !== 4 ||
    pawn.pathIndex !== null
  )
    return pawnPoint(pawn, gameType, spec);
  const base = BASE_AREA[pawn.color];
  const left = pawn.index % 2 ? SIGNATURE_NEST_HI : SIGNATURE_NEST_LO;
  const top = pawn.index >= 2 ? SIGNATURE_NEST_HI : SIGNATURE_NEST_LO;
  return gridPoint(
    base.rowStart + (top / 100) * 6 - 0.5,
    base.colStart + (left / 100) * 6 - 0.5,
  );
}

function Piece({
  pawn,
  allPawns,
  legal,
  onMove,
  move,
  mode,
  gameType = "ludo",
  soundEnabled = true,
  boardStyle = "signature",
  spec = BOARD_4,
  colorBlind = false,
  reducedMotion = false,
  focused = false,
}: {
  pawn: Pawn;
  allPawns: Pawn[];
  legal: boolean;
  onMove: (id: string) => void;
  move: PresentationFrame["move"];
  mode: InteractionMode;
  gameType?: GameType;
  soundEnabled?: boolean;
  boardStyle?: "signature" | "classic" | "geometric" | "aladdin";
  /** Which Luddo board: the 4-arm cross or the 6-arm hexagon (F5.2). */
  spec?: BoardSpec;
  colorBlind?: boolean;
  /** Land on the new square at once: no hops, no trail (F5.5). */
  reducedMotion?: boolean;
  /** Picked out from the keyboard piece list: lifted like a hover. */
  focused?: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.Group>(null);
  const trailSamples = useRef<Point[]>([]);
  const trailSampleElapsed = useRef(0);
  const trailOpacity = useRef(0);
  const coarse = useCoarsePointer();
  const soundedStep = useRef(0);
  const previous = useRef(pawn);
  const previousMove = useRef(move);
  const motion = useRef<{
    points: Point[];
    elapsed: number;
    delay: number;
  } | null>(null);
  // Reduced motion: the next frame puts the piece straight on its square.
  const snap = useRef(false);
  const [hovered, setHovered] = useState(false);
  const classicPawn = boardStyle === "classic" && gameType === "ludo";
  const aladdinPawn = boardStyle === "aladdin" && gameType === "ludo";
  const spreadPawn = classicPawn || aladdinPawn;
  // Hex cells are smaller than the cross's, so the whole piece (and its
  // ring, flash and stack spacing) shrinks to fit one.
  const scale = pieceScale(spec);
  const pawnHeight =
    (classicPawn
      ? CLASSIC_PAWN_HEIGHT
      : aladdinPawn
        ? ALADDIN_PAWN_HEIGHT
        : GLASS_PAWN_HEIGHT) * scale;
  // Outer radius of the legal-move highlight ring and the move-flash disc.
  // The cell-filling glass disc needs a wider ring than the slimmer
  // classic/aladdin figures.
  const highlightRadius = spreadPawn ? 0.218 : 0.225;
  const point = (piece: Pawn) => simPawnPoint(piece, gameType, spec, boardStyle);
  const [initial] = useState(() => point(pawn));
  const stack = allPawns
    .filter(
      (p) =>
        p.pathIndex !== null &&
        pawn.pathIndex !== null &&
        point(p)[0] === point(pawn)[0] &&
        point(p)[2] === point(pawn)[2],
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const stackIndex = stack.findIndex((p) => p.id === pawn.id);
  const offset: Point =
    stack.length > 1
      ? spreadPawn
        ? [
            ((stackIndex % 2) - 0.5) * 0.13 * scale,
            0,
            ((Math.floor(stackIndex / 2) % 2) - 0.5) * 0.13 * scale,
          ]
        : [
            ((stackIndex % 2) - 0.5) * 0.025,
            stackIndex * (pawnHeight + 0.006),
            ((Math.floor(stackIndex / 2) % 2) - 0.5) * 0.025,
          ]
      : [0, 0, 0];
  useEffect(() => {
    const from = previous.current;
    if (
      from.pathIndex !== pawn.pathIndex ||
      (gameType === "snakes_and_ladders" &&
        move?.pawnId === pawn.id &&
        previousMove.current !== move)
    ) {
      const isCapture = pawn.pathIndex === null;
      const moved = allPawns.find((p) => p.id === move?.pawnId);
      const start =
        moved && move?.fromTileId
          ? gameType === "snakes_and_ladders"
            ? Number(move.fromTileId.split(":")[1])
            : tileIdToPathIndex(moved.color, move.fromTileId, spec)
          : null;
      const movingSteps =
        start === null ? 1 : Math.max(1, (moved?.pathIndex ?? start) - start);
      if (reducedMotion) {
        motion.current = null;
        snap.current = true;
        trailOpacity.current = 0;
        // One sound for the whole move, instead of one per hop.
        if (soundEnabled && move?.pawnId === pawn.id)
          playSoundEffect(move.finishesPawn ? "pawnHome" : "pawnHop", move.finishesPawn ? 0.7 : 0.46);
        previous.current = pawn;
        previousMove.current = move;
        return;
      }
      const waypoints = moveWaypoints(from, pawn, gameType, move, spec);
      // A capture sends the piece back to its nest; land it on this board's
      // own nest circle rather than the shared slot position.
      if (pawn.pathIndex === null && waypoints.length)
        waypoints[waypoints.length - 1] = point(pawn);
      motion.current = {
        points: [
          ref.current
            ? (ref.current.position.toArray() as Point)
            : point(from),
          ...waypoints,
        ],
        elapsed: 0,
        delay: isCapture ? (movingSteps * HOP_MS) / 1000 : 0,
      };
      trailSamples.current = [];
      trailSampleElapsed.current = 0;
      trailOpacity.current = 1;
      soundedStep.current = 0;
    }
    previous.current = pawn;
    previousMove.current = move;
    // soundEnabled and reducedMotion are read at the moment a move starts;
    // toggling either shouldn't restart the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pawn, allPawns, move, gameType, spec]);
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    const m = motion.current;
    let moving = false;
    if (m) {
      m.elapsed += Math.min(delta, 0.1);
      const t = Math.max(0, m.elapsed - m.delay) / (HOP_MS / 1000),
        index = Math.floor(t);
      const arrivedStep = Math.min(index, m.points.length - 1);
      if (m.elapsed >= m.delay && arrivedStep > soundedStep.current) {
        soundedStep.current = arrivedStep;
        const reachedHome =
          arrivedStep === m.points.length - 1 &&
          move?.pawnId === pawn.id &&
          move.finishesPawn;
        if (soundEnabled) {
          if (reachedHome) playSoundEffect("pawnHome", 0.7);
          else playSoundEffect("pawnHop", 0.46);
        }
      }
      if (index >= m.points.length - 1) {
        const p = point(pawn);
        ref.current.position.set(
          p[0] + offset[0],
          p[1] + offset[1],
          p[2] + offset[2],
        );
        motion.current = null;
      } else {
        moving = m.elapsed >= m.delay;
        const a = m.points[index],
          destination = m.points[index + 1],
          b =
            index === m.points.length - 2
              ? (destination.map(
                  (value, axis) => value + offset[axis],
                ) as Point)
              : destination,
          f = t - index,
          e = f * f * (3 - 2 * f);
        ref.current.position.set(
          THREE.MathUtils.lerp(a[0], b[0], e),
          THREE.MathUtils.lerp(a[1], b[1], e) +
            Math.sin(f * Math.PI) *
              (gameType === "snakes_and_ladders" &&
              move?.landingSquare !== undefined &&
              index >=
                move.landingSquare -
                  (Number(move.fromTileId?.split(":")[1]) || 0)
                ? 0
                : 0.1),
          THREE.MathUtils.lerp(a[2], b[2], e),
        );
      }
    } else {
      // Not this pawn's turn to hop, but its stack offset can still shift
      // when another pawn joins/leaves the same cell — ease into that
      // instead of snapping, so a stationary piece never visibly teleports.
      // Reduced motion does snap: a move lands in one step.
      const p = point(pawn);
      const damp = snap.current || reducedMotion ? 1 : 1 - Math.exp(-delta * 10);
      snap.current = false;
      ref.current.position.set(
        THREE.MathUtils.lerp(ref.current.position.x, p[0] + offset[0], damp),
        THREE.MathUtils.lerp(ref.current.position.y, p[1] + offset[1], damp),
        THREE.MathUtils.lerp(ref.current.position.z, p[2] + offset[2], damp),
      );
    }
    if (moving) {
      trailSampleElapsed.current += delta;
      if (
        trailSampleElapsed.current >= 0.035 ||
        trailSamples.current.length === 0
      ) {
        trailSampleElapsed.current = 0;
        trailSamples.current.unshift([
          ref.current.position.x,
          BOARD_Y + 0.014,
          ref.current.position.z,
        ]);
        trailSamples.current.length = Math.min(trailSamples.current.length, 6);
      }
      trailOpacity.current = 1;
    } else {
      trailOpacity.current = Math.max(0, trailOpacity.current - delta * 2.8);
    }
    if (trail.current) {
      trail.current.children.forEach((child, index) => {
        const sample = trailSamples.current[index];
        const mesh = child as THREE.Mesh;
        mesh.visible = !!sample && trailOpacity.current > 0;
        if (!sample) return;
        mesh.position.set(...sample);
        const age = 1 - index / trail.current!.children.length;
        mesh.scale.setScalar((0.55 + age * 0.6) * scale);
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = trailOpacity.current * age * 0.52;
      });
    }
    ref.current.scale.setScalar(((hovered || focused) && legal ? 1.12 : 1) * scale);
    if (ring.current) {
      ring.current.visible = legal;
      ring.current.scale.setScalar(
        reducedMotion ? 1 : 1 + Math.sin(clock.elapsedTime * 4) * 0.1,
      );
    }
  });
  const clickable = legal && mode === "play";
  return (
    <>
      <group ref={trail}>
        {Array.from({ length: 6 }, (_, index) => (
          <mesh
            key={index}
            visible={false}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.17, 20]} />
            <meshBasicMaterial
              color={seatColors(colorBlind)[pawn.color]}
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>
      <group
        ref={ref}
        position={initial}
        onPointerDown={(e) => {
          if (mode === "play") e.stopPropagation();
        }}
        onClick={(e) => {
          if (mode !== "play") return;
          e.stopPropagation();
          if (e.delta > TAP_SLOP_PX) return;
          if (clickable) {
            document.body.classList.remove("sim-piece-hover");
            setHovered(false);
            if (coarse) hapticTap();
            onMove(pawn.id);
          }
        }}
        onPointerOver={(e) => {
          if (!clickable) return;
          e.stopPropagation();
          document.body.classList.add("sim-piece-hover");
          setHovered(true);
        }}
        onPointerOut={() => {
          document.body.classList.remove("sim-piece-hover");
          setHovered(false);
        }}
      >
        {classicPawn ? (
          <ClassicPawn color={pawn.color} colorBlind={colorBlind} />
        ) : aladdinPawn ? (
          <AladdinPawn color={pawn.color} colorBlind={colorBlind} />
        ) : (
          <GlassPawn color={pawn.color} colorBlind={colorBlind} />
        )}
        <mesh
          ref={ring}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.009, 0]}
        >
          {/* The signature glass disc now fills a cell, so its highlight ring
              and move-flash sit further out than the smaller classic/aladdin
              figures' do. */}
          <ringGeometry args={[highlightRadius - 0.023, highlightRadius, 32]} />
          <meshBasicMaterial
            color="#ffdf94"
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
        <PieceMoveFlash
          active={legal}
          color={seatColors(colorBlind)[pawn.color]}
          radius={highlightRadius}
          reducedMotion={reducedMotion}
        />
        {clickable && (
          <mesh position={[0, 0.12, 0]} visible={false}>
            <cylinderGeometry
              args={[coarse ? 0.3 : 0.24, coarse ? 0.3 : 0.24, 0.26, 12]}
            />
            <meshBasicMaterial />
          </mesh>
        )}
      </group>
    </>
  );
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ],
};
// Faces: +Y=1, -Y=6, +Z=2, -Z=5, +X=3, -X=4. Opposites sum to seven.
const DIE_FACES: { value: number; position: Point; rotation: Point }[] = [
  { value: 1, position: [0, 0.231, 0], rotation: [-Math.PI / 2, 0, 0] },
  { value: 6, position: [0, -0.231, 0], rotation: [Math.PI / 2, 0, 0] },
  { value: 2, position: [0, 0, 0.231], rotation: [0, 0, 0] },
  { value: 5, position: [0, 0, -0.231], rotation: [0, Math.PI, 0] },
  { value: 3, position: [0.231, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { value: 4, position: [-0.231, 0, 0], rotation: [0, -Math.PI / 2, 0] },
];
const DIE_ROTATION: Record<number, Point> = {
  1: [0, 0, 0],
  2: [-Math.PI / 2, 0, 0],
  3: [0, 0, Math.PI / 2],
  4: [0, 0, -Math.PI / 2],
  5: [Math.PI / 2, 0, 0],
  6: [Math.PI, 0, 0],
};
const TOUCH_DIE_SCALE = 1.45;
// Where each colour's 4-player desktop seat label is anchored (Seats pushes
// the label a fixed screen distance outward from this point), so the die
// rests right beside the name. Beyond the board's own edge (its frame spans
// +-3.18), never toward the far/near corners.
const DESKTOP_FOUR_PLAYER_DIE_POINTS: Record<PlayerColor, Point> = {
  red: [-3.5, 0.26, -1.3],
  green: [3.5, 0.26, -1.3],
  yellow: [3.5, 0.26, 1.3],
  blue: [-3.5, 0.26, 1.3],
  // Hex-only colours never use this table (5-6 players are on the hexagon).
  orange: [3.5, 0.26, -3.3],
  black: [-3.5, 0.26, -3.3],
};
// Seat label anchors, board-local — shared by Seats and the die so the die
// always lands beside the active player's label. Phones pin labels near the
// board's corners; wider screens put 2-3 players above/below the board.
const SEAT_POINTS: Record<PlayerColor, Point> = {
  red: [-1.8, BOARD_Y, -3.5],
  green: [1.8, BOARD_Y, -3.5],
  yellow: [1.8, BOARD_Y, 3.5],
  blue: [-1.8, BOARD_Y, 3.5],
  // Hex-only colours: 5-6 player seats use hexSeatPoint() instead.
  orange: [3.5, BOARD_Y, 0],
  black: [-3.5, BOARD_Y, 0],
};
const MOBILE_CORNER_SEAT_POINTS: Record<PlayerColor, Point> = {
  red: [-2.15, BOARD_Y, -3.52],
  green: [2.15, BOARD_Y, -3.52],
  yellow: [2.15, BOARD_Y, 3.52],
  blue: [-2.15, BOARD_Y, 3.52],
  orange: [3.52, BOARD_Y, 0],
  black: [-3.52, BOARD_Y, 0],
};
const DIE_Y = 0.26;
// How long the die takes to slide to the next player when the turn passes.
const DIE_PASS_MS = 480;

/** Which seat-label layout a table uses (mirrors the choice in Seats). */
function seatLayout(
  compact: boolean,
  hex: boolean,
  playerCount: number,
): "hex" | "corners" | "sides" | "edges" {
  if (hex) return "hex";
  if (compact && (playerCount === 4 || playerCount === 2)) return "corners";
  if (!compact && playerCount === 4) return "sides";
  return "edges";
}

/**
 * Board-local resting point for the die on `color`'s turn: beside that
 * player's seat label, on the board side of it, so the die reads as being
 * in their hands — like a real die passed around the table.
 */
function dieSeatPoint(
  layout: ReturnType<typeof seatLayout>,
  color: PlayerColor,
): Point {
  if (layout === "hex") {
    // A little along the rim from the label, toward the next seat.
    const [x, z] = hexPolar(hexBaseAngle(color) + 0.3, HEX_SLAB_RADIUS + 0.35);
    return [x, DIE_Y, z];
  }
  if (layout === "sides") return DESKTOP_FOUR_PLAYER_DIE_POINTS[color];
  const [x, , z] = (layout === "corners" ? MOBILE_CORNER_SEAT_POINTS : SEAT_POINTS)[color];
  // Just inside the label, toward the middle of the same board edge.
  return [Math.sign(x) * (layout === "corners" ? 0.78 : 0.55), DIE_Y, Math.sign(z) * 3.58];
}

function rotateTablePoint(point: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    point[0] * cosine + point[2] * sine,
    point[1],
    -point[0] * sine + point[2] * cosine,
  ];
}

function PhysicalDie({
  frame,
  canRoll,
  onRoll,
  mode,
  players,
  turnPlayerId,
  orientation,
  gameType,
  reducedMotion = false,
}: Pick<
  SceneProps,
  | "frame"
  | "canRoll"
  | "onRoll"
  | "mode"
  | "players"
  | "turnPlayerId"
  | "orientation"
  | "gameType"
  | "reducedMotion"
>) {
  const mesh = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const cue = useRef<THREE.Mesh>(null);
  const compact = useThree(
    ({ size }) => size.width <= 900 || size.height <= 650,
  );
  const coarse = useCoarsePointer();
  // ~40pt across on a phone instead of ~25pt, lifted so it still rests on
  // the table rather than sinking into it.
  const dieScale = coarse ? TOUCH_DIE_SCALE : 1;
  const lift = (dieScale - 1) * 0.23;
  const activePlayer = players.find(
    (player) => player.id === (frame.actorId ?? turnPlayerId),
  );
  // The die travels to whoever's turn it is and rests beside their seat
  // label (see dieSeatPoint): where the die is says whose turn it is. On a
  // phone your own turn brings it to your near corner, in thumb reach.
  const hex = sceneSpec({ gameType, players, frame }).arms === 6;
  const layout = seatLayout(compact, hex, players.length);
  const activeColor = activePlayer?.color;
  const baseRestingPoint = useMemo<Point>(() => {
    if (!activeColor) return [0, DIE_Y, 3.58];
    if (!compact || layout === "hex")
      return rotateTablePoint(dieSeatPoint(layout, activeColor), orientation);
    // A phone's portrait view only has room above and below the board, and
    // the board turns (by up to 90deg) to put your base bottom-left — which
    // swings a board-local spot off the side of the screen. So on a phone
    // the die goes to the screen corner that player's seat turned into:
    // above the board for far seats, below it for near ones.
    const seat = (layout === "corners" ? MOBILE_CORNER_SEAT_POINTS : SEAT_POINTS)[activeColor];
    const [x, , z] = rotateTablePoint(seat, orientation);
    // Corner labels sit over the board's bases, so the die can come out to
    // the base's own x; edge labels (3 players, Snakes & Ladders) sit just
    // past the board, so it tucks further in to clear them.
    const inset = layout === "corners" ? 0.78 : 0.42;
    return [Math.sign(x || 1) * inset, DIE_Y, Math.sign(z || 1) * 3.6];
  }, [activeColor, compact, layout, orientation]);
  const restingPoint = useMemo<Point>(
    () => [baseRestingPoint[0], baseRestingPoint[1] + lift, baseRestingPoint[2]],
    [baseRestingPoint, lift],
  );
  const restingVector = useMemo(
    () => new THREE.Vector3(...restingPoint),
    [restingPoint],
  );
  // A plain white die: where it rests (beside the active player's seat,
  // see dieSeatPoint) already says whose turn it is, so it no longer takes
  // on the acting player's colour.
  const dieColor = "#ffffff";
  const dieAttenuationColor = "#ffffff";
  const pipColor = "#111111";
  const elapsed = useRef(ROLL_MS / 1000);
  const target = useMemo(
    () =>
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...DIE_ROTATION[frame.dice]),
      ),
    [frame.dice],
  );
  const lastRoll = useRef(frame.rollId);
  // Passing the die: when the turn changes, it slides (with a small hop) from
  // where it sat to the next player's spot instead of teleporting, so the
  // eye follows it to whoever is up. Skipped under reduced motion.
  const passFrom = useRef<THREE.Vector3 | null>(null);
  const passElapsed = useRef(0);
  useEffect(() => {
    if (!mesh.current || reducedMotion) return;
    if (mesh.current.position.distanceTo(restingVector) < 0.01) return;
    passFrom.current = mesh.current.position.clone();
    passElapsed.current = 0;
  }, [restingVector, reducedMotion]);
  useEffect(() => {
    const overDie = hovered && mode === "play";
    // Roll-ready → pointer cursor; hovering the die when it isn't this
    // player's turn → a not-allowed cursor, so the die reads as "can't
    // click this right now" instead of silently ignoring the tap.
    document.body.classList.toggle("sim-die-hover", overDie && canRoll);
    document.body.classList.toggle("sim-die-blocked", overDie && !canRoll);
    return () => {
      document.body.classList.remove("sim-die-hover");
      document.body.classList.remove("sim-die-blocked");
    };
  }, [canRoll, hovered, mode]);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    if (frame.rollId !== lastRoll.current) {
      lastRoll.current = frame.rollId;
      // Reduced motion skips the tumble: the die just shows its new face.
      elapsed.current = reducedMotion ? ROLL_MS / 1000 : 0;
    }
    elapsed.current += Math.min(delta, 0.1);
    const hoverScale =
      (hovered && canRoll && mode === "play" ? 1.08 : 1) * dieScale;
    if (cue.current) {
      const showCue = coarse && canRoll && mode === "play";
      cue.current.visible = showCue;
      if (showCue) {
        // A steady ring rather than a pulse under reduced motion.
        const beat = reducedMotion ? 0.35 : (performance.now() / 1150) % 1;
        cue.current.position.set(restingPoint[0], 0.2, restingPoint[2]);
        cue.current.scale.setScalar(dieScale * (0.9 + beat * 0.55));
        (cue.current.material as THREE.MeshBasicMaterial).opacity =
          0.75 * (1 - beat);
      }
    }
    mesh.current.scale.setScalar(
      THREE.MathUtils.damp(mesh.current.scale.x, hoverScale, 12, delta),
    );
    const t = Math.min(1, elapsed.current / (ROLL_MS / 1000));
    if (t < 0.7) {
      mesh.current.rotation.x += delta * 17;
      mesh.current.rotation.z += delta * 13;
      if (compact) {
        const progress = THREE.MathUtils.smoothstep(t / 0.7, 0, 1);
        mesh.current.position.set(
          restingPoint[0] +
            Math.sin(progress * Math.PI * 5) * 0.28 * (1 - progress),
          restingPoint[1] +
            Math.abs(Math.sin(progress * Math.PI * 4)) *
              (1 - progress) *
              0.9,
          restingPoint[2] +
            Math.cos(progress * Math.PI * 4) * 0.24 * (1 - progress),
        );
      } else {
        mesh.current.position.set(
          restingPoint[0] + Math.sin(t * 9) * 0.12,
          restingPoint[1] +
            Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) * 0.85,
          restingPoint[2] + (1 - t) * 0.4,
        );
      }
    } else if (passFrom.current) {
      mesh.current.quaternion.slerp(target, 1 - Math.exp(-delta * 24));
      passElapsed.current += Math.min(delta, 0.1);
      const p = Math.min(1, passElapsed.current / (DIE_PASS_MS / 1000));
      const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      mesh.current.position
        .copy(passFrom.current)
        .lerp(restingVector, eased);
      mesh.current.position.y += Math.sin(p * Math.PI) * 0.55 * dieScale;
      if (p === 1) passFrom.current = null;
    } else {
      mesh.current.quaternion.slerp(target, 1 - Math.exp(-delta * 24));
      mesh.current.position.lerp(
        restingVector,
        1 - Math.exp(-delta * 24),
      );
      if (t === 1) {
        mesh.current.quaternion.copy(target);
        mesh.current.position.copy(restingVector);
      }
    }
  });
  return (
    <group>
      <mesh ref={cue} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.36, 0.4, 48]} />
        <meshBasicMaterial
          color="#ffdf94"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group
        ref={mesh}
        position={restingPoint}
        onPointerDown={(e) => {
          if (mode === "play") e.stopPropagation();
        }}
        onClick={(e) => {
          if (mode !== "play") return;
          e.stopPropagation();
          if (!canRoll || e.delta > TAP_SLOP_PX) return;
          if (coarse) hapticTap(18);
          onRoll();
        }}
        onPointerOver={(e) => {
          // Register the hover even when the player can't roll, so an
          // out-of-turn hover can surface the not-allowed cursor; the
          // roll-only visuals (grow/glow) stay gated on canRoll elsewhere.
          if (mode !== "play") return;
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <RoundedBox
          args={[0.46, 0.46, 0.46]}
          radius={0.055}
          smoothness={4}
          castShadow
        >
          <meshPhysicalMaterial
            color={dieColor}
            roughness={compact ? 0.015 : 0.025}
            metalness={0}
            clearcoat={1}
            clearcoatRoughness={0.01}
            transmission={compact ? 0.05 : 0.12}
            thickness={compact ? 0.3 : 0.82}
            ior={1.49}
            attenuationColor={dieAttenuationColor}
            attenuationDistance={0.28}
            specularIntensity={1}
            specularColor="#ffffff"
            envMapIntensity={compact ? 2.8 : 2.2}
            transparent
            opacity={1}
            emissive={compact ? dieColor : canRoll ? dieColor : "#000000"}
            emissiveIntensity={compact ? 0.14 : canRoll ? 0.025 : 0}
          />
        </RoundedBox>
        {DIE_FACES.map((face) => (
          <group
            key={face.value}
            position={face.position}
            rotation={face.rotation}
          >
            {PIPS[face.value].map(([x, y], i) => (
              <mesh key={i} position={[x * 0.105, y * 0.105, 0]}>
                <circleGeometry args={[0.031, 16]} />
                <meshPhysicalMaterial
                  color={pipColor}
                  roughness={0.22}
                  clearcoat={0.65}
                />
              </mesh>
            ))}
          </group>
        ))}
        {canRoll && (
          <mesh visible={false}>
            <sphereGeometry args={[0.4, 12, 12]} />
            <meshBasicMaterial />
          </mesh>
        )}
      </group>
    </group>
  );
}

// How far (px) a press may travel and still count as a tap on a pawn or the
// die; anything further was a drag of the view.
const TAP_SLOP_PX = 10;

/**
 * Which Luddo board the table shows. Orange and black seats exist only on the
 * 6-arm hexagon (F5.2) — the same inference the server makes — so the seats
 * and pawns decide it; Snakes & Ladders always uses the square slab.
 */
function sceneSpec({
  gameType,
  players,
  frame,
}: Pick<SceneProps, "gameType" | "players" | "frame">): BoardSpec {
  if (gameType === "snakes_and_ladders") return BOARD_4;
  return boardSpecForColors([
    ...players.map((player) => player.color),
    ...frame.pawns.map((pawn) => pawn.color),
  ]);
}

/** Corner radius of the hexagonal slab (its apothem is HEX_SLAB_APOTHEM). */
const HEX_SLAB_RADIUS = HEX_SLAB_APOTHEM / Math.cos(Math.PI / 6);

// About 1.4 cells — roughly a fingertip's width on a phone-sized board.
const TOUCH_PAWN_REACH = 0.55;

const HEX_ARTWORK: Record<HexBoardStyle, { src: string }> = {
  classic: hexClassicArtwork,
  signature: hexSignatureArtwork,
  geometric: hexGeometricArtwork,
  aladdin: hexAladdinArtwork,
};

/**
 * The printed top of the 5-6 player hexagon in the table's board style.
 * Its own component so only a hex table fetches hex artwork, and only the
 * chosen style's file. CircleGeometry's UVs span its bounding square, which
 * is exactly the artwork's viewBox; starting at 30deg lines its corners up
 * with the printed hexagon's.
 */
function HexBoardTop({
  style,
  vectorSize,
  colorBlind = false,
}: {
  style: HexBoardStyle;
  vectorSize: number;
  colorBlind?: boolean;
}) {
  // Every hex board is vector art, so colour-blind mode recolours its source.
  const src = HEX_ARTWORK[style].src;
  const image = useLoader(
    colorBlind ? SeatRecolorLoader : THREE.ImageLoader,
    colorBlind ? `${src}#seats=hex-${style}` : src,
  );
  const texture = useMemo(() => makeBoardTexture(image, "full", 1, vectorSize), [image, vectorSize]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[HEX_ART_RADIUS, 6, Math.PI / 6]} />
      <meshBasicMaterial map={texture} toneMapped={false} color="#ffffff" />
    </mesh>
  );
}

function BoardObject(props: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);
  const pieces = useRef<THREE.Group>(null);
  const snakeHeads = useRef<THREE.Group>(null);
  const spec = sceneSpec(props);
  const hex = spec.arms === 6;
  const targetFlip = props.gameType === "snakes_and_ladders" ? Math.PI : 0;
  const [initialFlip] = useState(targetFlip);
  const flip = useRef({ from: targetFlip, to: targetFlip, elapsed: 1.5 });
  const [initialRotation] = useState(props.orientation);
  // Board artwork is only ever a source image for makeBoardTexture's
  // canvas, so it's loaded as a plain image — not useTexture, which uploads
  // every texture to the GPU on load. That upload was wasted memory for
  // all five boards, and for SVGs with no pixel size (width="100%") it
  // failed outright with WebGL "bad image data" / "Texture is immutable".
  // Keep in sync with BOARD_IMAGE_SOURCES in lib/presentation/preloadScene.ts.
  // Only the chosen Snakes & Ladders board is fetched (F2.6), so the default
  // game never pays for the second board's artwork.
  const snakeSrc = (props.snakesBoard === 1 ? snakeArtwork2 : snakeArtwork).src as string;
  // Colour-blind mode (F5.5) loads the vector boards with their seat
  // colours rewritten (SeatRecolorLoader); the raster signature board is
  // recoloured in makeBoardTexture instead.
  const colorBlind = !!props.colorBlind;
  const seats = (src: string, artworkKey: string) =>
    colorBlind ? `${src}#seats=${artworkKey}` : src;
  const [artwork, classicArtwork, geometricArtwork, aladdinArtwork, snakeSource] =
    useLoader(colorBlind ? SeatRecolorLoader : THREE.ImageLoader, [
      boardArtwork.src,
      seats(classicBoardArtwork.src as string, "classic"),
      seats(geometricBoardArtwork.src as string, "geometric"),
      seats(aladdinBoardArtwork.src as string, "aladdin"),
      snakeSrc,
    ]);
  // Vector boards are rasterized once into a texture. On a desktop screen
  // at 2x the board spans ~2000 device px at its near edge, so 2048 gets
  // magnified and the thin numbers/labels go soft; 4096 keeps them crisp.
  // Phones never show the board that large, so they keep 2048 (a 4096
  // texture costs ~90MB of GPU memory with mipmaps), as does Low quality.
  const maxTextureSize = useThree((state) => state.gl.capabilities.maxTextureSize);
  const compactScreen = useThree(
    ({ size }) => size.width <= 900 || size.height <= 650,
  );
  const vectorSize =
    !compactScreen && props.quality !== "low" && maxTextureSize >= 4096
      ? 4096
      : 2048;
  const texture = useMemo(
    () => {
      const classic = props.boardStyle === "classic";
      const geometric = props.boardStyle === "geometric";
      const aladdin = props.boardStyle === "aladdin";
      return makeBoardTexture(
        classic ? classicArtwork : geometric ? geometricArtwork : aladdin ? aladdinArtwork : artwork,
        classic ? "full" : geometric ? "full" : aladdin ? "full" : "ludo",
        props.view === "overhead" ? 1.24 : 1,
        vectorSize,
        colorBlind,
      );
    },
    [artwork, classicArtwork, geometricArtwork, aladdinArtwork, props.boardStyle, props.view, vectorSize, colorBlind],
  );
  const snakeTexture = useMemo(
    () => makeBoardTexture(snakeSource, "full", 1, vectorSize),
    [snakeSource, vectorSize],
  );
  const lampTexture = useTexture(lampArtwork.src as string);
  const wood = useTexture("/textures/board-wood.webp");
  const drag = useRef<{ x: number; angle: number; pointer: number } | null>(
    null,
  );
  const angle = useRef(props.orientation);
  const dragging = useRef(false);
  const coarse = useCoarsePointer();
  // A fingertip covers more than a cell, so on touch a tap that misses
  // every pawn still counts if a legal one is close by — the nearest
  // wins. Direct hits never get here: Piece stops propagation.
  function tapNearestLegalPawn(e: ThreeEvent<MouseEvent>) {
    if (!coarse || props.mode !== "play" || !group.current) return;
    if (props.legalPawnIds.length === 0 || e.delta > TAP_SLOP_PX) return;
    const local = group.current.worldToLocal(e.point.clone());
    let best: { id: string; distance: number } | null = null;
    for (const pawn of props.frame.pawns) {
      if (!props.legalPawnIds.includes(pawn.id)) continue;
      const [x, , z] = simPawnPoint(
        pawn,
        props.gameType ?? "ludo",
        spec,
        props.boardStyle ?? "signature",
      );
      const distance = Math.hypot(x - local.x, z - local.z);
      if (!best || distance < best.distance) best = { id: pawn.id, distance };
    }
    if (!best || best.distance > TOUCH_PAWN_REACH) return;
    e.stopPropagation();
    hapticTap();
    props.onMove(best.id);
  }
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => snakeTexture.dispose(), [snakeTexture]);
  useEffect(() => {
    if (flip.current.to !== targetFlip)
      flip.current = {
        from: board.current?.rotation.x ?? flip.current.to,
        to: targetFlip,
        elapsed: 0,
      };
  }, [targetFlip]);
  useEffect(() => {
    if (props.mode !== "rotate") {
      drag.current = null;
      dragging.current = false;
    }
  }, [props.mode]);
  useFrame((_, delta) => {
    if (!group.current) return;
    // Reduced motion turns the board in one step, and flips it between
    // Luddo and Snakes & Ladders without the lift and spin.
    if (!dragging.current)
      angle.current +=
        shortestAngle(angle.current, props.orientation) *
        (props.reducedMotion ? 1 : 1 - Math.exp(-delta * 9));
    group.current.rotation.y = angle.current;
    const f = flip.current;
    f.elapsed = props.reducedMotion ? 1.5 : Math.min(1.5, f.elapsed + delta);
    const t = f.elapsed / 1.5;
    if (board.current) {
      board.current.rotation.x = THREE.MathUtils.lerp(
        f.from,
        f.to,
        t * t * (3 - 2 * t),
      );
      board.current.position.y = 0.1 + Math.sin(t * Math.PI) * 3.4;
    }
    if (pieces.current) pieces.current.visible = t === 1;
    if (snakeHeads.current) snakeHeads.current.visible = t === 1;
  });
  function down(e: ThreeEvent<PointerEvent>) {
    // Right-drag spins the board immediately in Play mode, without
    // switching modes — it's freed from CameraControls (see mouseButtons
    // in CameraRig) specifically so the two never compete for the same
    // gesture. Explicit Rotate mode keeps accepting any button/touch.
    // The party screen never spins the board — it has no way to spin it back.
    if (props.screen) return;
    const defaultRotateDrag = props.mode === "play" && e.button === 2;
    if (props.mode !== "rotate" && !defaultRotateDrag) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, angle: angle.current, pointer: e.pointerId };
    dragging.current = true;
  }
  function up(e: ThreeEvent<PointerEvent>) {
    if (!drag.current) return;
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    drag.current = null;
    dragging.current = false;
    // Snap to a whole seat: quarter turns on the cross, sixths on the hex.
    const step = rotationStep(spec);
    props.onRotate(Math.round(angle.current / step) * step);
  }
  return (
    <group
      ref={group}
      rotation={[0, initialRotation, 0]}
      onPointerDown={down}
      onPointerMove={(e) => {
        if (!drag.current) return;
        e.stopPropagation();
        angle.current =
          drag.current.angle + (e.clientX - drag.current.x) * 0.008;
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={tapNearestLegalPawn}
    >
      <group ref={board} position={[0, 0.1, 0]} rotation={[initialFlip, 0, 0]}>
        {hex ? (
          // A hexagonal slab for 5-6 players (F5.2). A 6-sided cylinder's
          // corners sit at +z and every 60deg, i.e. at the bases, with its
          // edges facing the arm tips — matching the printed hex boards.
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[HEX_SLAB_RADIUS, HEX_SLAB_RADIUS, 0.17, 6]} />
            <meshPhysicalMaterial
              color="#726046"
              map={wood}
              roughness={0.3}
              clearcoat={0.6}
            />
          </mesh>
        ) : (
          <RoundedBox
            args={[6.36, 0.17, 6.36]}
            radius={0.065}
            castShadow
            receiveShadow
          >
            <meshPhysicalMaterial
              color="#726046"
              map={wood}
              roughness={0.3}
              clearcoat={0.6}
            />
          </RoundedBox>
        )}
        {hex ? (
          <HexBoardTop
            style={props.boardStyle ?? "signature"}
            vectorSize={vectorSize}
            colorBlind={colorBlind}
          />
        ) : (
          <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[BOARD_SIZE, BOARD_SIZE]} />
            <meshBasicMaterial
              map={texture}
              // Treat the printed artwork as self-lit color reference: room lights,
              // reflections, shadows, and the filmic curve must not alter its inks.
              toneMapped={false}
              color="#ffffff"
            />
          </mesh>
        )}
        {props.boardStyle === "aladdin" && (
          // Billboard cancels every ancestor rotation (board spin, flip,
          // even the camera orbiting around the table), not just the
          // board's own spin -- the lamp always faces the viewer, like a
          // HUD marker rather than a decal resting flush on the board.
          <Billboard position={[0, 0.12, 0]}>
            <mesh>
              <planeGeometry args={[0.52, 0.35]} />
              <meshBasicMaterial
                map={lampTexture}
                transparent
                toneMapped={false}
              />
            </mesh>
          </Billboard>
        )}
        {/* The square Snakes & Ladders print on the underside; a hex table
            never flips over (Snakes stays 2-4 players), and the square would
            poke out past the hexagon's edges. */}
        {!hex && (
          <mesh position={[0, -0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[BOARD_SIZE, BOARD_SIZE]} />
            <meshBasicMaterial
              map={snakeTexture}
              toneMapped={false}
              color="#ffffff"
            />
          </mesh>
        )}
        {/* Brass studs in the slab's corners. */}
        {(hex
          ? Array.from({ length: 6 }, (_, k): [number, number] => {
              const angle = Math.PI / 2 + (k * Math.PI) / 3;
              const reach = (HEX_ART_RADIUS + HEX_SLAB_RADIUS) / 2;
              return [Math.cos(angle) * reach, Math.sin(angle) * reach];
            })
          : [-1, 1].flatMap((x) => [-1, 1].map((z): [number, number] => [x * 3.09, z * 3.09]))
        ).map(([x, z]) => (
          <mesh
            key={`${x}:${z}`}
            position={[x, 0.09, z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <circleGeometry args={[0.022, 12]} />
            <meshStandardMaterial
              color="#ccb785"
              metalness={0.7}
              roughness={0.3}
            />
          </mesh>
        ))}
      </group>
      <Seats {...props} />
      <group ref={pieces}>
        {props.gameType !== "snakes_and_ladders" &&
          !props.preview &&
          (() => {
            const activeColor = props.players.find(
              (player) =>
                player.id === (props.frame.actorId ?? props.turnPlayerId),
            )?.color;
            return spec.colors.map((color) => (
              <BaseHighlight
                key={color}
                color={color}
                tint={seatColors(colorBlind)[color]}
                hex={hex}
                active={activeColor === color}
                anyActive={!!activeColor}
                reducedMotion={props.reducedMotion}
              />
            ));
          })()}
        {/* Colour-blind mode marks each base with its seat's symbol, in the
            middle of the base, clear of the nest slots. */}
        {props.gameType !== "snakes_and_ladders" &&
          colorBlind &&
          !props.preview &&
          spec.colors.map((color) => (
            <BaseSymbol key={color} color={color} hex={hex} />
          ))}
        {!props.preview && (
          <TurnBoardFlash
            hex={hex}
            snakes={props.gameType === "snakes_and_ladders"}
            color={
              props.players.find(
                (player) =>
                  player.id === (props.frame.actorId ?? props.turnPlayerId),
              )?.color
            }
            palette={seatColors(colorBlind)}
            reducedMotion={props.reducedMotion}
          />
        )}
        {props.gameType !== "snakes_and_ladders" &&
          !props.preview &&
          !props.hideLabels &&
          props.players.map((player) => (
            <BaseName
              key={player.id}
              color={player.color}
              hex={hex}
              name={player.id === props.myPlayerId ? "You" : player.displayName}
            />
          ))}
        {props.frame.pawns.map((pawn) => (
          <Piece
            key={`${props.gameType}:${props.frame.revision}:${pawn.id}`}
            spec={spec}
            gameType={props.gameType}
            pawn={pawn}
            allPawns={props.frame.pawns}
            legal={props.legalPawnIds.includes(pawn.id)}
            mode={props.mode}
            move={props.frame.move}
            onMove={props.onMove}
            soundEnabled={props.soundEnabled}
            boardStyle={props.boardStyle}
            colorBlind={colorBlind}
            reducedMotion={props.reducedMotion}
            focused={props.focusedPawnId === pawn.id}
          />
        ))}
      </group>
      {props.gameType === "snakes_and_ladders" && (
        <group ref={snakeHeads}>
          <SnakeHeads snakesBoard={props.snakesBoard} still={props.reducedMotion} />
        </group>
      )}
    </group>
  );
}

/**
 * Marks whose turn it is with a single "torch" flash across the whole board:
 * a bright bar of light, tinted toward white over the active player's
 * colour, that sweeps from their base across to the far side. No lit rim,
 * halo, or drop shadow — just the travelling light. When the turn passes,
 * the tint eases to the next player's colour and the sweep turns to start
 * from their base. Lives in the pieces group so it spins with the board and
 * hides during the Ludo/Snakes flip like the pawns do.
 */
// Shared torch-flash tuning, used by the active base and by movable pieces so
// the two read as the same light: how fast the band travels (cycles/sec) and
// how wide it is (in normalised 0..1 sweep space). SWEEP_PARK is the uTime
// that parks the band mid-region under prefers-reduced-motion.
const SWEEP_SPEED = 0.22;
const SWEEP_BAND = 0.13;
const SWEEP_PARK = 0.5 / SWEEP_SPEED;
// The board-wide flash crosses the whole board, not one small base, so at
// the shared speed it read as rushing past; it travels at half the speed.
const BOARD_SWEEP_SPEED = SWEEP_SPEED / 2;
const BOARD_SWEEP_PARK = 0.5 / BOARD_SWEEP_SPEED;
const BASE_GLOW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BOARD_FLASH_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uHalf;
  uniform float uExtent;
  uniform float uRound;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uExtent;
    // Inside the board: its square, or (uRound) the disc inside the hexagon.
    vec2 q = abs(p) - vec2(uHalf);
    float square = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float d = mix(square, length(p) - uHalf, uRound);
    float inside = 1.0 - smoothstep(-0.04, 0.0, d);
    // A band travelling along uDir: from the active player's base (s = 0)
    // across the board to the far side (s = 1), entering and leaving past
    // each edge. 1.42 covers the square's corner-to-corner diagonal.
    float s = dot(p, uDir) / (2.0 * uHalf * 1.42) + 0.5;
    float sweepPos = fract(uTime * ${BOARD_SWEEP_SPEED}) * 1.4 - 0.2;
    float e = (s - sweepPos) / ${SWEEP_BAND};
    float sweep = exp(-e * e) * inside;
    // Kept faint and mostly the player's own hue (little white wash) so the
    // band glazes the board rather than hiding the squares beneath it.
    float alpha = uIntensity * sweep * 0.14;
    vec3 color = mix(uColor, vec3(1.0), sweep * 0.25);
    gl_FragColor = vec4(color, alpha);
  }
`;
// The current base, marked the way Ludo King makes the active player stand
// out: by contrast. The active base gets a lit rim (its colour washed toward
// warm white) with a brighter spot drifting round it like a marquee light,
// and every other base sits under a light veil. uActive/uDim are eased
// per base so a turn change cross-fades; uRound switches the square base
// for the hexagon's round one.
const BASE_HIGHLIGHT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uActive;
  uniform float uDim;
  uniform float uTime;
  uniform float uHalf;
  uniform float uExtent;
  uniform float uRound;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uExtent;
    vec2 q = abs(p) - vec2(uHalf);
    float square = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float d = mix(square, length(p) - uHalf, uRound);
    float inside = 1.0 - smoothstep(-0.02, 0.0, d);
    // Rim: a bright line straddling the base's edge, softly haloed.
    float rim = exp(-pow(d / 0.035, 2.0)) + 0.35 * exp(-pow(d / 0.12, 2.0));
    // Marquee: a brighter spot travelling slowly round the rim, once
    // every ~7s — a gentle drift, not a spin.
    float around = atan(p.y, p.x) / 6.2831853 + 0.5;
    float gap = fract(around - uTime * 0.14);
    float chase = exp(-pow(min(gap, 1.0 - gap) / 0.07, 2.0));
    vec3 lit = mix(uColor, vec3(1.0, 0.96, 0.84), 0.55 + 0.4 * chase);
    float rimAlpha = uActive * rim * (0.55 + 0.45 * chase);
    // A light veil over bases that aren't up: enough to let the active
    // base lead, not so much that the board reads dark.
    float veil = uDim * inside * 0.1;
    vec3 color = mix(vec3(0.02, 0.03, 0.02), lit, rimAlpha / max(rimAlpha + veil, 1e-4));
    gl_FragColor = vec4(color, clamp(rimAlpha + veil, 0.0, 1.0));
  }
`;
function BaseHighlight({
  color,
  tint,
  active,
  anyActive,
  hex = false,
  reducedMotion = false,
}: {
  color: PlayerColor;
  /** The seat's colour in the palette in use. */
  tint: string;
  active: boolean;
  /** Someone is up — only then do the other bases dim. */
  anyActive: boolean;
  hex?: boolean;
  reducedMotion?: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  let x: number, z: number, half: number;
  if (hex) {
    [x, z] = hexBaseCenter(color);
    half = HEX_BASE_RADIUS;
  } else {
    const area = BASE_AREA[color];
    [x, , z] = gridPoint(
      (area.rowStart + area.rowEnd) / 2,
      (area.colStart + area.colEnd) / 2,
    );
    half = ((area.colEnd - area.colStart + 1) * CELL) / 2;
  }
  // Room past the edge for the rim's halo.
  const extent = (half + 0.2) * 2;
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(tint) },
      uActive: { value: 0 },
      uDim: { value: 0 },
      uTime: { value: 0 },
      uHalf: { value: half },
      uExtent: { value: extent },
      uRound: { value: hex ? 1 : 0 },
    }),
    [tint, half, extent, hex],
  );
  useFrame(({ clock }, delta) => {
    if (!mesh.current || !material.current) return;
    const u = material.current.uniforms;
    const ease = 1 - Math.exp(-delta * 7);
    u.uActive.value += ((active ? 1 : 0) - u.uActive.value) * ease;
    u.uDim.value += ((anyActive && !active ? 1 : 0) - u.uDim.value) * ease;
    // Under reduced motion the rim stays lit but the marquee stands still.
    u.uTime.value = reducedMotion ? 0 : clock.elapsedTime;
    mesh.current.visible = u.uActive.value > 0.002 || u.uDim.value > 0.002;
  });
  return (
    <mesh
      ref={mesh}
      position={[x, BOARD_Y + 0.005, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
      visible={false}
    >
      <planeGeometry args={[extent, extent]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={BASE_GLOW_VERTEX}
        fragmentShader={BASE_HIGHLIGHT_FRAGMENT}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
// The same travelling light, masked to a disc — for a movable piece.
const PIECE_FLASH_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uRadius;
  uniform float uExtent;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uExtent;
    float inside = 1.0 - smoothstep(uRadius - 0.02, uRadius, length(p));
    float s = (p.x + p.y) / (2.0 * uRadius) * 0.5 + 0.5;
    float sweepPos = fract(uTime * ${SWEEP_SPEED}) * 1.4 - 0.2;
    float e = (s - sweepPos) / ${SWEEP_BAND};
    float sweep = exp(-e * e) * inside;
    float alpha = uIntensity * sweep * 0.6;
    vec3 color = mix(uColor, vec3(1.0), sweep * 0.7);
    gl_FragColor = vec4(color, alpha);
  }
`;
function TurnBoardFlash({
  color,
  palette,
  hex = false,
  snakes = false,
  reducedMotion = false,
}: {
  /** The active player's colour; no flash while nobody is up. */
  color?: PlayerColor;
  /** Seat colours in the palette in use. */
  palette: Record<PlayerColor, string>;
  hex?: boolean;
  /** Snakes & Ladders has no bases: the sweep runs from square 1's corner. */
  snakes?: boolean;
  reducedMotion?: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const intensity = useRef(0);
  const half = hex ? HEX_ART_RADIUS * Math.cos(Math.PI / 6) : BOARD_SIZE / 2;
  const extent = half * 2 + 0.1;
  // The sweep's direction: from the active base through the centre.
  const direction = useMemo(() => {
    // Plane-local (1, 1) points from the bottom-left corner (square 1).
    if (!color || snakes) return new THREE.Vector2(1, 1).normalize();
    let x: number, z: number;
    if (hex) [x, z] = hexBaseCenter(color);
    else {
      const area = BASE_AREA[color];
      [x, , z] = gridPoint(
        (area.rowStart + area.rowEnd) / 2,
        (area.colStart + area.colEnd) / 2,
      );
    }
    // Plane space: the mesh lies flat (rotated -90deg about x), so its local
    // y runs along the board's -z.
    return new THREE.Vector2(-x, z).normalize();
  }, [color, hex, snakes]);
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color("#ffffff") },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uHalf: { value: half },
      uExtent: { value: extent },
      uRound: { value: hex ? 1 : 0 },
      uDir: { value: new THREE.Vector2(1, 0) },
    }),
    [half, extent, hex],
  );
  const targetColor = useMemo(
    () => new THREE.Color(color ? palette[color] : "#ffffff"),
    [color, palette],
  );
  useFrame(({ clock }, delta) => {
    if (!mesh.current || !material.current) return;
    const ease = 1 - Math.exp(-delta * 7);
    intensity.current += ((color ? 1 : 0) - intensity.current) * ease;
    const u = material.current.uniforms;
    u.uIntensity.value = intensity.current;
    // The tint and the sweep's heading ease over to the next player.
    (u.uColor.value as THREE.Color).lerp(targetColor, ease);
    (u.uDir.value as THREE.Vector2).lerp(direction, ease).normalize();
    // Under reduced motion the band is parked mid-board (no travel) so it
    // reads as a steady soft light rather than a moving flash.
    u.uTime.value = reducedMotion ? BOARD_SWEEP_PARK : clock.elapsedTime;
    mesh.current.visible = intensity.current > 0.002;
  });
  return (
    <mesh
      ref={mesh}
      position={[0, BOARD_Y + 0.004, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={1}
      visible={false}
    >
      <planeGeometry args={[extent, extent]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={BASE_GLOW_VERTEX}
        fragmentShader={BOARD_FLASH_FRAGMENT}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * The same travelling torch flash as the active base, on a small disc laid
 * flat under a movable piece — so a pawn you can move reads as "lit" by the
 * same light. Rides inside the Piece group, so it follows the pawn as it
 * hops. Fades in/out as the piece becomes (un)movable.
 */
function PieceMoveFlash({
  active,
  color,
  radius,
  reducedMotion = false,
}: {
  active: boolean;
  /** The piece's colour in the palette in use. */
  color: string;
  radius: number;
  reducedMotion?: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const intensity = useRef(0);
  const extent = (radius + 0.02) * 2;
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uRadius: { value: radius },
      uExtent: { value: extent },
    }),
    [color, radius, extent],
  );
  useFrame(({ clock }, delta) => {
    if (!mesh.current || !material.current) return;
    intensity.current +=
      ((active ? 1 : 0) - intensity.current) * (1 - Math.exp(-delta * 7));
    const u = material.current.uniforms;
    u.uIntensity.value = intensity.current;
    u.uTime.value = reducedMotion ? SWEEP_PARK : clock.elapsedTime;
    mesh.current.visible = intensity.current > 0.002;
  });
  return (
    <mesh
      ref={mesh}
      position={[0, 0.006, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={1}
      visible={false}
    >
      <planeGeometry args={[extent, extent]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={BASE_GLOW_VERTEX}
        fragmentShader={PIECE_FLASH_FRAGMENT}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// The name plate lies flat on the base, in the gap between its two bottom
// (nearest-the-seat) nest slots.
const BASE_NAME_WIDTH = 1.7; // world units; fits between the two bottom corner slots
const BASE_NAME_HEIGHT = BASE_NAME_WIDTH * (132 / 512); // matches makeNameTexture's canvas aspect
// How far from the base centre the plate drops toward the seat — about where
// the two bottom nest slots sit (~0.94 from centre), pulled in a hair so the
// plate stays clear of the base's edge.
const BASE_NAME_DROP = 0.9;
// Each name is written horizontally and turned so it reads upright from its
// own seat: the two far bases (red top-left, green top-right) are flipped a
// half-turn, the two near bases (blue, yellow) sit as drawn. Hex seats are
// unused on the 4-arm board (F5.2), so they inherit the near orientation.
const BASE_NAME_SPIN: Record<PlayerColor, number> = {
  red: Math.PI,
  green: Math.PI,
  yellow: 0,
  blue: 0,
  orange: 0,
  black: 0,
};

/**
 * The player's name embedded on their base quadrant — flat on the board,
 * centred between the four nest slots, and oriented to read upright from
 * that base's own seat (see BASE_NAME_SPIN). Lives in the pieces group with
 * the base glow so it spins with the board and hides during the Ludo/Snakes
 * flip like the pawns do.
 */
// Hex bases are round and smaller, so the plate is narrower and sits across
// the base's outer side, beyond the nest slots.
const HEX_NAME_WIDTH = 0.9;
const HEX_NAME_DROP = 0.5;

function BaseName({
  color,
  name,
  hex = false,
}: {
  color: PlayerColor;
  name: string;
  hex?: boolean;
}) {
  // Every name plate carries its seat's symbol, palette or not (F5.5).
  const texture = useMemo(() => makeNameTexture(name, SEAT_SYMBOLS[color]), [name, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  if (hex) {
    const angle = hexBaseAngle(color);
    const [bx, bz] = hexBaseCenter(color);
    // Text reads upright from outside the board: its "down" (the plane's
    // -y, turned by `spin`) points away from the centre, along `angle`.
    const spin = Math.PI / 2 - angle;
    return (
      <mesh
        position={[
          bx + Math.cos(angle) * HEX_NAME_DROP,
          BOARD_Y + 0.006,
          bz + Math.sin(angle) * HEX_NAME_DROP,
        ]}
        rotation={[-Math.PI / 2, 0, spin]}
        renderOrder={2}
      >
        <planeGeometry args={[HEX_NAME_WIDTH, HEX_NAME_WIDTH * (132 / 512)]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    );
  }
  const area = BASE_AREA[color];
  const [x, , z] = gridPoint(
    (area.rowStart + area.rowEnd) / 2,
    (area.colStart + area.colEnd) / 2,
  );
  // The plate drops toward the seat — the direction the text reads "down"
  // (+z for the near bases at spin 0, -z for the far ones at spin π).
  const spin = BASE_NAME_SPIN[color];
  const nameZ = z + (spin === 0 ? 1 : -1) * BASE_NAME_DROP;
  return (
    <mesh
      position={[x, BOARD_Y + 0.006, nameZ]}
      rotation={[-Math.PI / 2, 0, spin]}
      renderOrder={2}
    >
      <planeGeometry args={[BASE_NAME_WIDTH, BASE_NAME_HEIGHT]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * Colour-blind mode's mark on a base (F5.5): the seat's symbol, flat in the
 * middle of the base where no nest slot sits; on a hex base that gap is
 * small (the 2x2 nest slots stop ~0.17 from its centre).
 */
function BaseSymbol({ color, hex }: { color: PlayerColor; hex: boolean }) {
  let x: number, z: number;
  if (hex) [x, z] = hexBaseCenter(color);
  else {
    const area = BASE_AREA[color];
    [x, , z] = gridPoint(
      (area.rowStart + area.rowEnd) / 2,
      (area.colStart + area.colEnd) / 2,
    );
  }
  return (
    <group
      position={[x, BOARD_Y + 0.007, z]}
      // Upright from the seat it belongs to, like the name plate.
      rotation={[-Math.PI / 2, 0, hex ? Math.PI / 2 - hexBaseAngle(color) : BASE_NAME_SPIN[color]]}
    >
      <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={hex ? 0.12 : 0.3} />
    </group>
  );
}

/**
 * The snakes are baked into the static board texture — there's no live
 * body to re-animate — so "the snake is alive" comes from a small overlay
 * at each head: a gentle side-to-side weave plus a tongue that flicks out
 * and back on a loop. Positions/facing come straight from SNAKES + the
 * same snakeSquarePoint() pawns use, so they always land on the printed
 * head/tail squares regardless of board layout changes.
 */
const Z_AXIS = new THREE.Vector3(0, 0, 1);
function SnakeHeads({
  snakesBoard,
  still = false,
}: {
  snakesBoard?: number;
  /** Reduced motion: no weaving heads or flicking tongues. */
  still?: boolean;
}) {
  const tongueTexture = useMemo(() => makeTongueTexture(), []);
  useEffect(() => () => tongueTexture.dispose(), [tongueTexture]);
  const tongueGeometry = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(0.045, 0.11);
    geometry.translate(0, 0.055, 0);
    return geometry;
  }, []);
  useEffect(() => () => tongueGeometry.dispose(), [tongueGeometry]);
  const snakes = useMemo(
    () =>
      Object.entries(snakesLayout(snakesBoard).snakes).map(([head, tail], i) => {
        const headSquare = Number(head);
        const [hx, hy, hz] = snakeSquarePoint(headSquare);
        const [tx, , tz] = snakeSquarePoint(tail);
        const dir = new THREE.Vector3(hx - tx, 0, hz - tz).normalize();
        const widthAxis = new THREE.Vector3(-dir.z, 0, dir.x);
        const up = new THREE.Vector3(0, 1, 0);
        const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(widthAxis, dir, up),
        );
        return {
          position: [hx, hy + 0.004, hz] as Point,
          baseQuaternion,
          phase: (headSquare % 7) * 0.9 + i,
          pause: 1 + (i % 4) * 0.3,
        };
      }),
    [snakesBoard],
  );
  const tongues = useRef<(THREE.Mesh | null)[]>([]);
  const cycles = useRef(
    snakes.map((snake) => ({ elapsed: -(snake.phase % snake.pause) })),
  );
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const FLICK = 0.24;
    snakes.forEach((snake, i) => {
      const mesh = tongues.current[i];
      if (!mesh) return;
      if (still) {
        mesh.scale.y = 0;
        return;
      }
      const wobble = Math.sin(t * 0.8 + snake.phase) * 0.3;
      mesh.quaternion
        .copy(snake.baseQuaternion)
        .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, wobble));
      const cycle = cycles.current[i];
      cycle.elapsed += delta;
      if (cycle.elapsed < 0) mesh.scale.y = 0;
      else if (cycle.elapsed < FLICK)
        mesh.scale.y = Math.sin((cycle.elapsed / FLICK) * Math.PI);
      else {
        mesh.scale.y = 0;
        if (cycle.elapsed > FLICK + snake.pause) cycle.elapsed = 0;
      }
    });
  });
  return (
    <>
      {snakes.map((snake, i) => (
        <mesh
          key={i}
          ref={(el) => {
            tongues.current[i] = el;
          }}
          position={snake.position}
          geometry={tongueGeometry}
          scale={[1, 0, 1]}
        >
          <meshBasicMaterial
            map={tongueTexture}
            transparent
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </>
  );
}

function Seats({
  players,
  myPlayerId,
  turnPlayerId,
  frame,
  reactions,
  speakingPlayerIds,
  preview,
  gameType,
  hideLabels,
  colorBlind,
}: SceneProps) {
  const compact = useThree(
    ({ size }) => size.width <= 900 || size.height <= 650,
  );
  if (preview || hideLabels) return null;
  const palette = seatColors(!!colorBlind);
  // Board-local anchors follow the same rotation as the artwork and pawns
  // (SEAT_POINTS / MOBILE_CORNER_SEAT_POINTS, shared with the die so it
  // always rests beside the active player's label).
  const positions = SEAT_POINTS;
  const mobileCornerPositions = MOBILE_CORNER_SEAT_POINTS;
  // Left/right of the board only, same anchor as that color's die point
  // (DESKTOP_FOUR_PLAYER_DIE_POINTS) — the label is then pushed away from
  // it by a fixed screen-pixel amount below, since a 3D-space gap shrinks
  // or grows with camera zoom and can't reliably clear a fixed-size die.
  const desktopSidePositions: Record<PlayerColor, Point> =
    DESKTOP_FOUR_PLAYER_DIE_POINTS;
  // 5-6 players on the hexagon: each label sits just past the board corner
  // beside its own base, turning with the board like the pawns.
  const hex = sceneSpec({ gameType, players, frame }).arms === 6;
  const hexSeat = (color: PlayerColor): Point => {
    const [x, z] = hexSeatPoint(color, HEX_SLAB_RADIUS + 0.45);
    return [x, BOARD_Y, z];
  };
  // Phones pin 2- and 4-player labels by their own corners (a duel used to
  // put both labels side by side under the board, which said nothing about
  // whose base was whose — or whose die it was).
  const cornerSeats =
    seatLayout(compact, hex, players.length) === "corners";
  const desktopFourPlayerSide = !hex && players.length === 4 && !cornerSeats;
  return (
    <>
      {players.map((player) => {
        const active = player.id === (frame.actorId ?? turnPlayerId);
        const position = hex
          ? hexSeat(player.color)
          : cornerSeats
            ? mobileCornerPositions[player.color]
            : players.length === 4
              ? desktopSidePositions[player.color]
            : positions[player.color];
        return (
          <Html
            key={player.id}
            position={position}
            center
            calculatePosition={(object, camera, size) => {
              const point = new THREE.Vector3()
                .setFromMatrixPosition(object.matrixWorld)
                .project(camera);
              const portrait = size.width / size.height < 0.9;
              const inset = portrait ? 66 : 108;
              const sidePush = desktopFourPlayerSide
                ? (player.color === "red" || player.color === "blue" ? -1 : 1) *
                  170
                : 0;
              const projectedY = ((1 - point.y) * size.height) / 2;
              const labelY =
                cornerSeats
                  ? projectedY
                  : compact && portrait
                  ? projectedY < size.height / 2
                    ? projectedY - 34
                    : projectedY + 34
                  : projectedY;
              return [
                THREE.MathUtils.clamp(
                  ((point.x + 1) * size.width) / 2 + sidePush,
                  inset,
                  size.width - inset,
                ),
                THREE.MathUtils.clamp(
                  labelY,
                  portrait ? 155 : 75,
                  size.height - (portrait ? 92 : 75),
                ),
              ];
            }}
            zIndexRange={[20, 10]}
            style={{ pointerEvents: "none" }}
          >
            <div
              className={`sim-seat ${active ? "is-active" : ""}`}
              style={
                { "--seat-color": palette[player.color] } as React.CSSProperties
              }
            >
              {reactions?.[player.id] && (
                <span className={`seat-reaction${isPhrase(reactions[player.id]) ? " is-phrase" : ""}`}>
                  {reactions[player.id]}
                </span>
              )}
              <PlayerAvatar player={player} size={34} className="seat-avatar" />
              {player.inVoice && (
                <span
                  className={`seat-mic ${speakingPlayerIds?.has(player.id) ? "speaking" : ""}`}
                >
                  <Icon name="mic" size={11} />
                </span>
              )}
              <span className="seat-copy">
                <strong>
                  <SeatSymbol color={player.color} seatColor={palette[player.color]} />
                  {player.id === myPlayerId ? "You" : player.displayName}
                </strong>
                <small>
                  {player.isBot
                    ? "Computer"
                    : player.status !== "connected"
                      ? "Reconnecting"
                      : player.partyRemote
                        ? "From elsewhere"
                        : "At the table"}
                  <span>
                    {" "}
                    ·{" "}
                    {gameType === "snakes_and_ladders" ? (
                      `${frame.pawns.find((p) => p.color === player.color)?.pathIndex ?? 0}/100`
                    ) : (
                      <>
                        {
                          frame.pawns.filter(
                            (p) =>
                              p.color === player.color &&
                              p.state === "finished",
                          ).length
                        }
                        /4 home
                      </>
                    )}
                  </span>
                </small>
              </span>
              <span className={`seat-dot ${active ? "active" : ""}`} />
            </div>
          </Html>
        );
      })}
    </>
  );
}

/**
 * Overhead on a phone looks straight down, so the room around the table
 * stops reading as a room and becomes clutter — couch backs, cushion
 * prints, the table's edge and floor bands, and the seat figures seen as
 * the tops of their heads. While the camera sits in that pose the room
 * steps aside for the same oak tabletop running off every screen edge;
 * the seat labels still say who's who.
 *
 * The apartment is still there: as soon as the player tilts the view
 * (Look mode) or pinches out past the default distance, the tabletop
 * fades away in step with the camera and the room comes back, then
 * settles again when they return to overhead. Zooming in or panning to
 * read cells keeps the clean table. Every other view, and desktop, always
 * show the full room.
 */
const REVEAL_TILT: readonly [number, number] = [0.1, 0.32]; // radians off straight down
const REVEAL_ZOOM_OUT: readonly [number, number] = [1.1, 1.3]; // x the overhead distance
function Surroundings({
  view,
  preview,
  tabletopTint,
  children,
}: {
  view: CameraView;
  preview?: boolean;
  tabletopTint: string;
  children: React.ReactNode;
}) {
  const compact = useThree(
    ({ size }) => size.width <= 900 || size.height <= 650,
  );
  const focused = view === "overhead" && compact && !preview;
  const room = useRef<THREE.Group>(null);
  const tabletop = useRef<THREE.Mesh>(null);
  const reveal = useRef(focused ? 0 : 1);
  const target = useMemo(() => new THREE.Vector3(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);
  const aspect = useThree(({ size }) => size.width / size.height);
  const homeDistance = useMemo(
    () => new THREE.Vector3(...cameraFraming("overhead", aspect).eye).length(),
    [aspect],
  );
  useFrame(({ camera, controls, gl }, delta) => {
    let goal = 1;
    if (focused) {
      const cameraControls = controls as CameraControlsImpl | null;
      if (cameraControls?.getTarget) cameraControls.getTarget(target);
      else target.set(0, 0, 0);
      offset.copy(camera.position).sub(target);
      const distance = offset.length();
      const tilt = Math.acos(THREE.MathUtils.clamp(offset.y / distance, -1, 1));
      goal = Math.max(
        THREE.MathUtils.smoothstep(tilt, REVEAL_TILT[0], REVEAL_TILT[1]),
        THREE.MathUtils.smoothstep(
          distance / homeDistance,
          REVEAL_ZOOM_OUT[0],
          REVEAL_ZOOM_OUT[1],
        ),
      );
    }
    reveal.current = THREE.MathUtils.damp(reveal.current, goal, 8, delta);
    if (Math.abs(reveal.current - goal) < 0.002) reveal.current = goal;
    const r = reveal.current;
    if (room.current) room.current.visible = r > 0.001;
    if (tabletop.current) {
      tabletop.current.visible = r < 0.999;
      const material = tabletop.current.material as THREE.MeshStandardMaterial;
      material.opacity = 1 - r;
      material.transparent = r > 0.001;
      material.depthWrite = r <= 0.001;
    }
    // Drives the overhead vignette in simulator.css, so it fades with the table.
    gl.domElement
      .closest<HTMLElement>(".sim-canvas")
      ?.style.setProperty("--sim-focus", String(1 - r));
  });
  return (
    <>
      <group ref={room}>{children}</group>
      {focused && <FocusedTabletop meshRef={tabletop} tint={tabletopTint} />}
    </>
  );
}

// Same scale as the coffee table's own top in Apartment (one texture over
// its 8.5 x 7.65 surface), mirror-tiled so no seam lines show. A hair above
// that real top so the two never z-fight while crossfading.
const FOCUSED_TABLETOP_SIZE = 40;
// The real table sits in the room's shade and reads as a muted greige;
// alone and fully lit, the same texture comes out far lighter. Matte,
// with no environment reflections, each room's `tabletopTint` (ROOM_LIGHTING)
// lands it on that room's table as rendered (the Apartment's measured
// ~#8f8980 on both).
function FocusedTabletop({
  meshRef,
  tint,
}: {
  meshRef: React.RefObject<THREE.Mesh | null>;
  tint: string;
}) {
  const source = useTexture("/textures/table-top.webp");
  const texture = useMemo(() => {
    const t = source.clone();
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
    t.repeat.set(FOCUSED_TABLETOP_SIZE / 8.5, FOCUSED_TABLETOP_SIZE / 7.65);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [source]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh
      ref={meshRef}
      position={[0, -0.004, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[FOCUSED_TABLETOP_SIZE, FOCUSED_TABLETOP_SIZE]} />
      <meshStandardMaterial
        map={texture}
        roughness={1}
        envMapIntensity={0}
        color={tint}
      />
    </mesh>
  );
}

// Video cards fall back to the 2D strip (V3) after three windows in a row
// under this frame rate. A window with a long stall (a backgrounded tab)
// doesn't count either way.
const VIDEO_MIN_FPS = 24;
const VIDEO_FPS_WINDOW = 2;
const VIDEO_SLOW_WINDOWS = 3;

/** Watches the frame rate while video cards are up, and says once when it's too low. */
function VideoFrameRateWatch({ onSlow }: { onSlow: () => void }) {
  const sample = useRef({ frames: 0, elapsed: 0, stalled: false });
  const slowWindows = useRef(0);
  const reported = useRef(false);
  useFrame((_, delta) => {
    if (reported.current) return;
    const w = sample.current;
    if (delta > 0.5) w.stalled = true;
    w.frames += 1;
    w.elapsed += delta;
    if (w.elapsed < VIDEO_FPS_WINDOW) return;
    const fps = w.frames / w.elapsed;
    if (!w.stalled) slowWindows.current = fps < VIDEO_MIN_FPS ? slowWindows.current + 1 : 0;
    sample.current = { frames: 0, elapsed: 0, stalled: false };
    if (slowWindows.current >= VIDEO_SLOW_WINDOWS) {
      reported.current = true;
      onSlow();
    }
  });
  return null;
}

/** Mounted inside the scene's main Suspense, so it only commits once everything in it has loaded. */
function SceneReady({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}

/**
 * The first-load screen over the canvas: picks up where the page's
 * dynamic() TableLoading fallback leaves off (same die, same spot) and
 * adds a real percent from three's loading manager while the board and
 * room textures stream in. Loader progress can dip when new files join
 * the queue, so the bar only ever moves forward. Shown once per mount —
 * later loads (e.g. an avatar face) never bring it back.
 */
function SceneLoadingOverlay({ ready, label }: { ready: boolean; label?: string }) {
  const loaded = useProgress((state) => state.progress);
  const [shown, setShown] = useState(0);
  const [gone, setGone] = useState(false);
  const target = ready ? 100 : Math.min(loaded, 99);
  if (target > shown) setShown(target);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setGone(true), 450);
    return () => clearTimeout(timer);
  }, [ready]);
  if (gone) return null;
  return (
    <TableLoading
      label={label}
      progress={shown}
      className={`scene-loading ${ready ? "is-done" : ""}`}
    />
  );
}

/**
 * Each room's light. The Apartment is cool daylight from its window wall;
 * the mahogany study is evening, lit warm and low by lamps, sconces and the
 * fire. The key light keeps one position so the table's shadows land the
 * same in every room. The printed board is self-lit and never changes.
 */
const ROOM_LIGHTING: Record<
  RoomStyle,
  {
    background: string;
    fog: [number, number];
    hemisphere: [string, string, number];
    key: [string, number];
    fill: [string, number];
    /** Reflection sources: window wall, ceiling, two side panels. */
    formers: [string, number][];
    tabletopTint: string;
  }
> = {
  apartment: {
    background: "#d4ddd4",
    fog: [32, 85],
    hemisphere: ["#edf3fa", "#717475", 1.8],
    key: ["#ffffff", 3.2],
    fill: ["#e6efff", 0.7],
    formers: [
      ["#edf4ff", 2],
      ["#ffffff", 1.3],
      ["#ffffff", 3.5],
      ["#dfeaff", 2.8],
    ],
    tabletopTint: "#8c98a8",
  },
  mahogany: {
    background: "#1a110c",
    fog: [36, 90],
    hemisphere: ["#ffdcb4", "#3a2418", 1.15],
    key: ["#ffe0bc", 2.6],
    fill: ["#ffc890", 0.55],
    formers: [
      ["#8a9cc8", 0.8],
      ["#ffe2bc", 1.1],
      ["#ffd0a0", 2.4],
      ["#ffc890", 2.0],
    ],
    tabletopTint: "#7a3228",
  },
  cafe: {
    background: "#dfe6ea",
    fog: [40, 95],
    hemisphere: ["#fff8ec", "#6b6257", 1.7],
    key: ["#fff3e2", 3.1],
    fill: ["#e8efff", 0.6],
    formers: [
      ["#f2f7ff", 2.4],
      ["#fff6e8", 1.3],
      ["#fff4e6", 3.2],
      ["#ffeedd", 2.6],
    ],
    tabletopTint: "#9a7454",
  },
  lake: {
    background: "#cfd8dc",
    fog: [40, 95],
    hemisphere: ["#fff1dc", "#5a4632", 1.5],
    key: ["#ffe2b8", 3.0],
    fill: ["#cfe0ff", 0.6],
    formers: [
      ["#dfeaff", 2.2],
      ["#ffeccc", 1.0],
      ["#ffe6c4", 3.0],
      ["#ffdcb0", 2.4],
    ],
    tabletopTint: "#a6784e",
  },
};

export default function SimulatorScene(props: SceneProps) {
  const lighting = ROOM_LIGHTING[props.room ?? "apartment"];
  // Render-scale ceiling PerformanceMonitor has stepped down to after
  // sustained low frame rates; null = no throttling, use the quality's max.
  const [performanceCap, setPerformanceCap] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  // Seeded from the same framing CameraRig converges on, using the
  // window's aspect as a stand-in for the canvas's (not yet mounted) —
  // so the first frame already looks right instead of starting from a
  // generic pose and animating into place.
  const [initialCamera] = useState(() => {
    const framing = cameraFraming(
      props.view,
      window.innerWidth / window.innerHeight,
      props.preview,
    );
    return { position: framing.eye, fov: framing.fov, near: 0.1, far: 120 };
  });
  const shadowSize = { low: 512, medium: 1024, high: 2048, ultra: 4096 }[
    props.quality
  ];
  // Max render scale per quality, still capped by the device's own pixel
  // ratio. Anything under the screen's real density renders the scene
  // small and lets the browser upscale it, which is what made the board's
  // numbers and edges soft (a 3x phone on medium was drawing ~42% of its
  // pixels). Medium — the phone default — now reaches 2x; high (desktop
  // default) covers 2x Retina fully.
  const dpr: { [K in Quality]: [number, number] } = {
    low: [1, 1],
    medium: [1, 2],
    high: [1, 2.5],
    ultra: [1, 3],
  };
  return (
    <div
      className={`sim-canvas mode-${props.mode} view-${props.view}`}
      style={
        {
          "--sim-brightness": props.brightness ?? 1,
          "--sim-saturation": props.saturation ?? 1,
        } as CSSProperties
      }
      // Right-drag rotates the board in Play mode (see BoardObject), so
      // the browser's native right-click menu must not interrupt it.
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        // "percentage" = PCFShadowMap. `true` asks for PCFSoftShadowMap, which
        // this three version removed (it warned and fell back to PCF anyway).
        shadows={props.quality !== "low" ? "percentage" : false}
        dpr={[1, Math.min(dpr[props.quality][1], performanceCap ?? Infinity)]}
        camera={initialCamera}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        fallback={
          <div className="sim-fallback">
            A physical 3D game table. Use the controls below to play. If the
            table is not visible, enable WebGL in your browser.
          </div>
        }
      >
        <color attach="background" args={[lighting.background]} />
        <fog attach="fog" args={[lighting.background, ...lighting.fog]} />
        <hemisphereLight args={lighting.hemisphere} />
        <directionalLight
          position={[-9, 10, 3]}
          intensity={lighting.key[1]}
          color={lighting.key[0]}
          castShadow
          shadow-mapSize={[shadowSize, shadowSize]}
          shadow-camera-left={-10}
          shadow-camera-right={10}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
          shadow-normalBias={0.025}
          shadow-bias={-0.0001}
        />
        <directionalLight
          position={[6, 8, -6]}
          intensity={lighting.fill[1]}
          color={lighting.fill[0]}
        />
        <Suspense fallback={null}>
          <Environment
            // Rendered once (frames={1}); a new room re-renders it.
            key={props.room ?? "apartment"}
            resolution={props.quality === "low" ? 64 : 128}
            frames={1}
          >
            <Lightformer
              position={[-10, 5, 0]}
              scale={[12, 8]}
              rotation={[0, Math.PI / 2, 0]}
              intensity={lighting.formers[0][1]}
              color={lighting.formers[0][0]}
            />
            <Lightformer
              position={[0, 8, 0]}
              scale={[10, 8]}
              rotation={[Math.PI / 2, 0, 0]}
              intensity={lighting.formers[1][1]}
              color={lighting.formers[1][0]}
            />
            <Lightformer
              position={[0, 2, 9]}
              scale={[3, 7]}
              rotation={[0, Math.PI, 0]}
              intensity={lighting.formers[2][1]}
              color={lighting.formers[2][0]}
            />
            <Lightformer
              position={[9, 2, 0]}
              scale={[2, 6]}
              rotation={[0, -Math.PI / 2, 0]}
              intensity={lighting.formers[3][1]}
              color={lighting.formers[3][0]}
            />
          </Environment>
          <Surroundings
            view={props.view}
            preview={props.preview}
            tabletopTint={lighting.tabletopTint}
          >
          {props.room === "mahogany" ? (
            <MahoganyRoom
              quality={props.quality}
              reducedMotion={props.reducedMotion}
            />
          ) : props.room === "cafe" ? (
            <CafeRoom quality={props.quality} />
          ) : props.room === "lake" ? (
            <LakeCabin
              quality={props.quality}
              reducedMotion={props.reducedMotion}
            />
          ) : (
            <Apartment quality={props.quality} />
          )}
          {/* Its own boundary: each player's avatar face is a separate
              texture that loads independently (see AvatarFace in
              PlayerAvatar3D.tsx). Sharing the outer Suspense meant every
              newly-requested face texture re-suspended the whole scene,
              briefly unmounting the board, pawns, and seat labels below —
              not just the avatar being loaded. */}
          <Suspense fallback={null}>
            <PlayerAvatars3D
              players={props.players}
              // Whoever the table is currently showing act — the mover
              // until their animation finishes — not the server's turn,
              // which has already moved on. Same rule as the seat labels,
              // die and base glow, so the ring doesn't jump ahead.
              turnPlayerId={props.frame.actorId ?? props.turnPlayerId}
              speakingPlayerIds={props.speakingPlayerIds}
              preview={props.preview}
              orientation={props.orientation}
              hex={sceneSpec(props).arms === 6}
              colorBlind={props.colorBlind}
              reducedMotion={props.reducedMotion}
              videoStreams={props.videoStreams}
              onVideoSelect={props.onVideoSelect}
            />
          </Suspense>
          {/* Inside Surroundings so it hides with the room: its baked
              9x9 patch shows a visible edge on the focused tabletop,
              where the key light's own shadow does the job instead. */}
          {props.quality !== "low" && (
            <ContactShadows
              position={[0, 0.002, 0]}
              scale={9}
              opacity={0.36}
              far={2}
              blur={2}
              resolution={256}
              frames={1}
              color="#332719"
            />
          )}
          </Surroundings>
          <BoardObject {...props} />
          {/* Not keyed by frame revision: it stays mounted so the die can
              slide from one player to the next when the turn passes. */}
          <PhysicalDie {...props} />
          <SceneReady onReady={markReady} />
        </Suspense>
        <CameraRig {...props} />
        {props.videoStreams && props.videoStreams.size > 0 && props.onVideoSlow && (
          <VideoFrameRateWatch onSlow={props.onVideoSlow} />
        )}
        {/* drei counts every adjustment toward `flipflops` — inclines
            included — and then stops sampling and fires onFallback. This
            used to hard-set 1x there, so a machine holding a steady 60fps
            racked up "inclines" and got dropped to 1x (blurry) ~10-15s
            after load. Now inclines recover resolution, declines shed it
            0.25 at a time, and fallback just keeps whatever it settled on. */}
        <PerformanceMonitor
          bounds={() => [28, 55]}
          flipflops={3}
          onIncline={() =>
            setPerformanceCap((cap) =>
              cap === null || cap + 0.25 >= dpr[props.quality][1]
                ? null
                : cap + 0.25,
            )
          }
          onDecline={() =>
            setPerformanceCap((cap) =>
              Math.max(1, (cap ?? dpr[props.quality][1]) - 0.25),
            )
          }
        />
      </Canvas>
      <SceneLoadingOverlay ready={ready} label={props.loadingLabel} />
    </div>
  );
}
