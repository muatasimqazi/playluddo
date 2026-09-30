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
import { tileIdToPathIndex } from "@/lib/board/geometry";
import { snakesLayout } from "@/lib/board/snakes";
import { BASE_AREA } from "@/components/arena/boardLayout";
import {
  BOARD_SIZE,
  BOARD_Y,
  CELL,
  COLORS,
  HOP_MS,
  gridPoint,
  ROLL_MS,
  moveWaypoints,
  pawnPoint,
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
import boardArtwork from "@/designs/board-design.webp";
import classicBoardArtwork from "@/designs/board-classic.svg";
import geometricBoardArtwork from "@/designs/board-geometric.svg";
import aladdinBoardArtwork from "@/designs/board-aladdin.svg";
import lampArtwork from "@/designs/lamp.svg";
import snakeArtwork from "@/designs/snake-and-ladder/snakes-and-ladders-board.svg";
import snakeArtwork2 from "@/designs/snake-and-ladder/snakes-and-ladders-board-2.svg";
import { makeBoardTexture, makeNameTexture, makeTongueTexture } from "./textures";
import { Apartment } from "./Apartment";
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
}

function CameraRig({
  view,
  mode,
  resetKey,
  actionCamera,
  frame,
  preview,
  screen,
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
  const cinematic =
    actionCamera === "cinematic" && frame.busy && mode === "play";
  const subtle = actionCamera === "subtle" && frame.busy && mode === "play";
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
    const animate = !firstFraming.current;
    firstFraming.current = false;
    void c.setLookAt(...eye, ...framing.target, animate);
  }, [view, mode, resetKey, mobile, aspect, cinematic, subtle, preview]);
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
  const [hovered, setHovered] = useState(false);
  const classicPawn = boardStyle === "classic" && gameType === "ludo";
  const aladdinPawn = boardStyle === "aladdin" && gameType === "ludo";
  const spreadPawn = classicPawn || aladdinPawn;
  const pawnHeight = classicPawn
    ? CLASSIC_PAWN_HEIGHT
    : aladdinPawn
      ? ALADDIN_PAWN_HEIGHT
      : GLASS_PAWN_HEIGHT;
  // Outer radius of the legal-move highlight ring and the move-flash disc.
  // The cell-filling glass disc needs a wider ring than the slimmer
  // classic/aladdin figures.
  const highlightRadius = spreadPawn ? 0.218 : 0.26;
  const point = (piece: Pawn) => pawnPoint(piece, gameType);
  const [initial] = useState(() => pawnPoint(pawn, gameType));
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
            ((stackIndex % 2) - 0.5) * 0.13,
            0,
            ((Math.floor(stackIndex / 2) % 2) - 0.5) * 0.13,
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
            : tileIdToPathIndex(moved.color, move.fromTileId)
          : null;
      const movingSteps =
        start === null ? 1 : Math.max(1, (moved?.pathIndex ?? start) - start);
      motion.current = {
        points: [
          ref.current
            ? (ref.current.position.toArray() as Point)
            : pawnPoint(from, gameType),
          ...moveWaypoints(from, pawn, gameType, move),
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
  }, [pawn, allPawns, move, gameType]);
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
        const p = pawnPoint(pawn, gameType);
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
      const p = pawnPoint(pawn, gameType);
      const damp = 1 - Math.exp(-delta * 10);
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
        mesh.scale.setScalar(0.55 + age * 0.6);
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = trailOpacity.current * age * 0.52;
      });
    }
    ref.current.scale.setScalar(hovered && legal ? 1.12 : 1);
    if (ring.current) {
      ring.current.visible = legal;
      ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.1);
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
              color={COLORS[pawn.color]}
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
          <ClassicPawn color={pawn.color} />
        ) : aladdinPawn ? (
          <AladdinPawn color={pawn.color} />
        ) : (
          <GlassPawn color={pawn.color} />
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
        <PieceMoveFlash active={legal} color={pawn.color} radius={highlightRadius} />
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
// On phones the die stays put at the near edge, bottom-center — in thumb
// reach and never hidden behind a far-side seat's 3D figure or tucked
// under a corner label. The glowing base and seat label already say
// whose turn it is, so the die doesn't need to travel to show it.
// z clears the board's frame (edge at 3.18) by the touch-sized die's
// half-width, so it sits on the table rather than overlapping the rim.
const MOBILE_DIE_POINT: Point = [0, 0.26, 3.6];
// Same Z as that color's label (desktopSidePositions below) so the die
// sits right next to their name, just closer to the board — same pairing
// mobile already uses (die x-magnitude < label x-magnitude, shared Z).
// Beyond the board's own edge (its frame spans +-3.18), never toward the
// far/near corners.
const DESKTOP_FOUR_PLAYER_DIE_POINTS: Record<PlayerColor, Point> = {
  red: [-3.5, 0.26, -1.3],
  green: [3.5, 0.26, -1.3],
  yellow: [3.5, 0.26, 1.3],
  blue: [-3.5, 0.26, 1.3],
  // F5.2: hex per-seat die points assigned in Phase 3; unused on the cross.
  orange: [3.5, 0.26, -3.3],
  black: [-3.5, 0.26, -3.3],
};
const DESKTOP_DIE_POINT: Point = [3.65, 0.26, 1.1];
// Snakes & Ladders has no per-player corners to track, so the die just
// sits in one fixed spot — bottom-right, never following whoever's turn
// it is or rotating with the board.
const SNAKES_DIE_POINT: Point = [1.8, 0.26, 3.3];

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
  const snakes = gameType === "snakes_and_ladders";
  // Per direct instruction: the die stays in one fixed spot every turn —
  // only its colour changes to reflect the acting player. (Previously, in
  // 4-player desktop it travelled to each player's corner; that movement
  // is disabled so the die never relocates.)
  const followsPlayer = false;
  const baseRestingPoint = useMemo<Point>(() => {
    // Phones first, for both games: Snakes & Ladders' desktop spot sits
    // right where a phone draws the second seat label, hiding the die.
    if (compact) return MOBILE_DIE_POINT;
    if (snakes) return SNAKES_DIE_POINT;
    if (!followsPlayer || !activePlayer) return DESKTOP_DIE_POINT;
    return rotateTablePoint(
      DESKTOP_FOUR_PLAYER_DIE_POINTS[activePlayer.color],
      orientation,
    );
  }, [activePlayer, compact, followsPlayer, orientation, snakes]);
  const restingPoint = useMemo<Point>(
    () => [baseRestingPoint[0], baseRestingPoint[1] + lift, baseRestingPoint[2]],
    [baseRestingPoint, lift],
  );
  const restingVector = useMemo(
    () => new THREE.Vector3(...restingPoint),
    [restingPoint],
  );
  // Per direct instruction: each turn the die takes on a lighter shade of
  // the acting player's base color instead of a fixed white — the base hue
  // mixed most of the way toward white, so it reads as (e.g.) a soft red
  // while the deep pips stay fully legible. Falls back to white when there
  // is no active player (e.g. between turns).
  // Light body tint (the visible surface colour) and the deeper, fully
  // saturated hue that drives the glass's transmission tint. Splitting the
  // two keeps the die looking light while still reading clearly as the
  // acting player's colour — a plain light `color` alone washes out to
  // white through the reflective clearcoat.
  const dieColor = useMemo(() => {
    if (!activePlayer) return "#ffffff";
    return `#${new THREE.Color(COLORS[activePlayer.color])
      .lerp(new THREE.Color("#ffffff"), 0.25)
      .getHexString()}`;
  }, [activePlayer]);
  const dieAttenuationColor = activePlayer
    ? COLORS[activePlayer.color]
    : "#ffffff";
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
      elapsed.current = 0;
    }
    elapsed.current += Math.min(delta, 0.1);
    const hoverScale =
      (hovered && canRoll && mode === "play" ? 1.08 : 1) * dieScale;
    if (cue.current) {
      const showCue = coarse && canRoll && mode === "play";
      cue.current.visible = showCue;
      if (showCue) {
        const beat = (performance.now() / 1150) % 1;
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
      {!followsPlayer && !compact && (
        <RoundedBox
          args={[0.92, 0.055, 1.55]}
          radius={0.02}
          position={[3.65, 0.028, 1.1]}
        >
          <meshStandardMaterial color="#9b9c98" roughness={0.84} />
        </RoundedBox>
      )}
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

// About 1.4 cells — roughly a fingertip's width on a phone-sized board.
const TOUCH_PAWN_REACH = 0.55;

function BoardObject(props: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);
  const pieces = useRef<THREE.Group>(null);
  const snakeHeads = useRef<THREE.Group>(null);
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
  const [artwork, classicArtwork, geometricArtwork, aladdinArtwork, snakeSource] =
    useLoader(THREE.ImageLoader, [
      boardArtwork.src,
      classicBoardArtwork.src as string,
      geometricBoardArtwork.src as string,
      aladdinBoardArtwork.src as string,
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
      );
    },
    [artwork, classicArtwork, geometricArtwork, aladdinArtwork, props.boardStyle, props.view, vectorSize],
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
      const [x, , z] = pawnPoint(pawn, props.gameType);
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
    if (!dragging.current)
      angle.current +=
        shortestAngle(angle.current, props.orientation) *
        (1 - Math.exp(-delta * 9));
    group.current.rotation.y = angle.current;
    const f = flip.current;
    f.elapsed = Math.min(1.5, f.elapsed + delta);
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
    props.onRotate(Math.round(angle.current / (Math.PI / 2)) * (Math.PI / 2));
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
        <mesh position={[0, -0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[BOARD_SIZE, BOARD_SIZE]} />
          <meshBasicMaterial
            map={snakeTexture}
            toneMapped={false}
            color="#ffffff"
          />
        </mesh>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <mesh
              key={`${x}:${z}`}
              position={[x * 3.09, 0.09, z * 3.09]}
              rotation={[-Math.PI / 2, 0, 0]}
            >
              <circleGeometry args={[0.022, 12]} />
              <meshStandardMaterial
                color="#ccb785"
                metalness={0.7}
                roughness={0.3}
              />
            </mesh>
          )),
        )}
      </group>
      <Seats {...props} />
      <group ref={pieces}>
        {props.gameType !== "snakes_and_ladders" &&
          !props.preview &&
          (Object.keys(BASE_AREA) as PlayerColor[]).map((color) => (
            <TurnBaseGlow
              key={color}
              color={color}
              active={
                props.players.find(
                  (player) =>
                    player.id === (props.frame.actorId ?? props.turnPlayerId),
                )?.color === color
              }
            />
          ))}
        {props.gameType !== "snakes_and_ladders" &&
          !props.preview &&
          !props.hideLabels &&
          props.players.map((player) => (
            <BaseName
              key={player.id}
              color={player.color}
              name={player.id === props.myPlayerId ? "You" : player.displayName}
            />
          ))}
        {props.frame.pawns.map((pawn) => (
          <Piece
            key={`${props.gameType}:${props.frame.revision}:${pawn.id}`}
            gameType={props.gameType}
            pawn={pawn}
            allPawns={props.frame.pawns}
            legal={props.legalPawnIds.includes(pawn.id)}
            mode={props.mode}
            move={props.frame.move}
            onMove={props.onMove}
            soundEnabled={props.soundEnabled}
            boardStyle={props.boardStyle}
          />
        ))}
      </group>
      {props.gameType === "snakes_and_ladders" && (
        <group ref={snakeHeads}>
          <SnakeHeads snakesBoard={props.snakesBoard} />
        </group>
      )}
    </group>
  );
}

/**
 * Marks the base of whoever's turn it is with a single "torch" flash: a
 * bright bar of light that sweeps across the base interior, tinted toward
 * white over that player's colour. No lit rim, halo, or drop shadow — just
 * the travelling light. When the turn passes, it fades out as the next base's
 * fades in. Lives in the pieces group so it spins with the board and hides
 * during the Ludo/Snakes flip like the pawns do.
 */
const BASE_FLASH_MARGIN = 0.05; // small plane margin past the base edge
// Shared torch-flash tuning, used by the active base and by movable pieces so
// the two read as the same light: how fast the band travels (cycles/sec) and
// how wide it is (in normalised 0..1 sweep space). SWEEP_PARK is the uTime
// that parks the band mid-region under prefers-reduced-motion.
const SWEEP_SPEED = 0.22;
const SWEEP_BAND = 0.13;
const SWEEP_PARK = 0.5 / SWEEP_SPEED;
const BASE_GLOW_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BASE_GLOW_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uHalf;
  uniform float uExtent;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * uExtent;
    vec2 q = abs(p) - vec2(uHalf);
    // Signed distance to the base's square edge: < 0 inside, > 0 outside.
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    // A bright bar of light travelling across the base interior — a diagonal
    // band swept edge to edge, with a clear entry/exit past each side.
    float inside = 1.0 - smoothstep(-0.03, 0.0, d);
    float s = (p.x + p.y) / (2.0 * uHalf) * 0.5 + 0.5;
    float sweepPos = fract(uTime * ${SWEEP_SPEED}) * 1.4 - 0.2;
    float e = (s - sweepPos) / ${SWEEP_BAND};
    float sweep = exp(-e * e) * inside;
    float alpha = uIntensity * sweep * 0.55;
    vec3 color = mix(uColor, vec3(1.0), sweep * 0.7);
    gl_FragColor = vec4(color, alpha);
  }
`;
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
function TurnBaseGlow({
  color,
  active,
}: {
  color: PlayerColor;
  active: boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const intensity = useRef(0);
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const area = BASE_AREA[color];
  const [x, , z] = gridPoint(
    (area.rowStart + area.rowEnd) / 2,
    (area.colStart + area.colEnd) / 2,
  );
  const half = ((area.colEnd - area.colStart + 1) * CELL) / 2;
  const extent = (half + BASE_FLASH_MARGIN) * 2;
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(COLORS[color]) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uHalf: { value: half },
      uExtent: { value: extent },
    }),
    [color, half, extent],
  );
  useFrame(({ clock }, delta) => {
    if (!mesh.current || !material.current) return;
    intensity.current +=
      ((active ? 1 : 0) - intensity.current) * (1 - Math.exp(-delta * 7));
    const u = material.current.uniforms;
    u.uIntensity.value = intensity.current;
    // Under reduced motion the band is parked mid-base (no travel) so it reads
    // as a steady soft light rather than a moving flash.
    u.uTime.value = reducedMotion ? SWEEP_PARK : clock.elapsedTime;
    mesh.current.visible = intensity.current > 0.002;
  });
  return (
    <mesh
      ref={mesh}
      position={[x, BOARD_Y + 0.004, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={1}
      visible={false}
    >
      <planeGeometry args={[extent, extent]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={BASE_GLOW_VERTEX}
        fragmentShader={BASE_GLOW_FRAGMENT}
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
}: {
  active: boolean;
  color: PlayerColor;
  radius: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const intensity = useRef(0);
  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const extent = (radius + 0.02) * 2;
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(COLORS[color]) },
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
function BaseName({ color, name }: { color: PlayerColor; name: string }) {
  const area = BASE_AREA[color];
  const [x, , z] = gridPoint(
    (area.rowStart + area.rowEnd) / 2,
    (area.colStart + area.colEnd) / 2,
  );
  const texture = useMemo(() => makeNameTexture(name), [name]);
  useEffect(() => () => texture.dispose(), [texture]);
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
 * The snakes are baked into the static board texture — there's no live
 * body to re-animate — so "the snake is alive" comes from a small overlay
 * at each head: a gentle side-to-side weave plus a tongue that flicks out
 * and back on a loop. Positions/facing come straight from SNAKES + the
 * same snakeSquarePoint() pawns use, so they always land on the printed
 * head/tail squares regardless of board layout changes.
 */
const Z_AXIS = new THREE.Vector3(0, 0, 1);
function SnakeHeads({ snakesBoard }: { snakesBoard?: number }) {
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
  orientation,
  hideLabels,
}: SceneProps) {
  const compact = useThree(
    ({ size }) => size.width <= 900 || size.height <= 650,
  );
  if (preview || hideLabels) return null;
  // Board-local anchors follow the same rotation as the artwork and pawns.
  const positions: Record<PlayerColor, Point> = {
    red: [-1.8, BOARD_Y, -3.5],
    green: [1.8, BOARD_Y, -3.5],
    yellow: [1.8, BOARD_Y, 3.5],
    blue: [-1.8, BOARD_Y, 3.5],
    // F5.2: hex seat anchors assigned in Phase 3; unused on the cross.
    orange: [3.5, BOARD_Y, 0],
    black: [-3.5, BOARD_Y, 0],
  };
  const mobileCornerPositions: Record<PlayerColor, Point> = {
    red: [-2.15, BOARD_Y, -3.52],
    green: [2.15, BOARD_Y, -3.52],
    yellow: [2.15, BOARD_Y, 3.52],
    blue: [-2.15, BOARD_Y, 3.52],
    orange: [3.52, BOARD_Y, 0],
    black: [-3.52, BOARD_Y, 0],
  };
  // Left/right of the board only, same anchor as that color's die point
  // (DESKTOP_FOUR_PLAYER_DIE_POINTS) — the label is then pushed away from
  // it by a fixed screen-pixel amount below, since a 3D-space gap shrinks
  // or grows with camera zoom and can't reliably clear a fixed-size die.
  const desktopSidePositions: Record<PlayerColor, Point> =
    DESKTOP_FOUR_PLAYER_DIE_POINTS;
  const mobileDuel = compact && players.length === 2;
  const mobileFourPlayer = compact && players.length === 4;
  const desktopFourPlayerSide = players.length === 4 && !mobileFourPlayer;
  const duelPlayers = [...players].sort((a, b) => {
    if (a.id === myPlayerId) return -1;
    if (b.id === myPlayerId) return 1;
    return a.seatIndex - b.seatIndex;
  });
  return (
    <>
      {players.map((player) => {
        const active = player.id === (frame.actorId ?? turnPlayerId);
        const duelIndex = duelPlayers.findIndex(({ id }) => id === player.id);
        const position = mobileDuel
          ? rotateTablePoint(
              [duelIndex === 0 ? -1.45 : 1.45, BOARD_Y, 3.46],
              -orientation,
            )
          : mobileFourPlayer
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
                mobileDuel || mobileFourPlayer
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
                  size.height - (portrait ? (mobileDuel ? 76 : 92) : 75),
                ),
              ];
            }}
            zIndexRange={[20, 10]}
            style={{ pointerEvents: "none" }}
          >
            <div
              className={`sim-seat ${mobileDuel ? "is-mobile-duel" : ""} ${active ? "is-active" : ""}`}
              style={
                { "--seat-color": COLORS[player.color] } as React.CSSProperties
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
  children,
}: {
  view: CameraView;
  preview?: boolean;
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
      {focused && <FocusedTabletop meshRef={tabletop} />}
    </>
  );
}

// Same scale as the coffee table's own top in Apartment (one texture over
// its 8.5 x 7.65 surface), mirror-tiled so no seam lines show. A hair above
// that real top so the two never z-fight while crossfading.
const FOCUSED_TABLETOP_SIZE = 40;
// The real table sits in the room's shade and reads as a muted greige;
// alone and fully lit, the same texture comes out far lighter. Matte,
// with no environment reflections, and this tint lands it on the room
// table's rendered color (measured ~#8f8980 on both).
const FOCUSED_TABLETOP_TINT = "#8c98a8";
function FocusedTabletop({
  meshRef,
}: {
  meshRef: React.RefObject<THREE.Mesh | null>;
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
        color={FOCUSED_TABLETOP_TINT}
      />
    </mesh>
  );
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

export default function SimulatorScene(props: SceneProps) {
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
        <color attach="background" args={["#d4ddd4"]} />
        <fog attach="fog" args={["#d4ddd4", 32, 85]} />
        <hemisphereLight args={["#edf3fa", "#717475", 1.8]} />
        <directionalLight
          position={[-9, 10, 3]}
          intensity={3.2}
          color="#ffffff"
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
          intensity={0.7}
          color="#e6efff"
        />
        <Suspense fallback={null}>
          <Environment
            resolution={props.quality === "low" ? 64 : 128}
            frames={1}
          >
            <Lightformer
              position={[-10, 5, 0]}
              scale={[12, 8]}
              rotation={[0, Math.PI / 2, 0]}
              intensity={2}
              color="#edf4ff"
            />
            <Lightformer
              position={[0, 8, 0]}
              scale={[10, 8]}
              rotation={[Math.PI / 2, 0, 0]}
              intensity={1.3}
              color="#ffffff"
            />
            <Lightformer
              position={[0, 2, 9]}
              scale={[3, 7]}
              rotation={[0, Math.PI, 0]}
              intensity={3.5}
              color="#ffffff"
            />
            <Lightformer
              position={[9, 2, 0]}
              scale={[2, 6]}
              rotation={[0, -Math.PI / 2, 0]}
              intensity={2.8}
              color="#dfeaff"
            />
          </Environment>
          <Surroundings view={props.view} preview={props.preview}>
          <Apartment quality={props.quality} />
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
          <PhysicalDie key={props.frame.revision} {...props} />
          <SceneReady onReady={markReady} />
        </Suspense>
        <CameraRig {...props} />
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
