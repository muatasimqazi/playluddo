"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import {
  CameraControls,
  CameraControlsImpl,
  ContactShadows,
  Environment,
  Html,
  Lightformer,
  PerformanceMonitor,
  RoundedBox,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import type { GameType, Pawn, Player, PlayerColor } from "@/lib/board/types";
import { tileIdToPathIndex } from "@/lib/board/geometry";
import { SNAKES } from "@/lib/board/snakes";
import {
  BOARD_SIZE,
  BOARD_Y,
  COLORS,
  HOP_MS,
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
import boardArtwork from "@/designs/board-design.png";
import classicBoardArtwork from "@/designs/board-classic.svg";
import geometricBoardArtwork from "@/designs/board-geometric.svg";
import aladdinBoardArtwork from "@/designs/board-aladdin.svg";
import snakeArtwork from "@/designs/snake-and-ladder/board.svg";
import { makeBoardTexture, makeTongueTexture } from "./textures";
import { Apartment } from "./Apartment";
import { GlassPawn, GLASS_PAWN_HEIGHT } from "./GlassPawn";
import { ClassicPawn, CLASSIC_PAWN_HEIGHT } from "./ClassicPawn";
import { AladdinPawn, ALADDIN_PAWN_HEIGHT } from "./AladdinPawn";
import { Icon } from "./Icon";
import { PlayerAvatars3D } from "./PlayerAvatar3D";

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
  hideLabels?: boolean;
  brightness?: number;
  saturation?: number;
}

function CameraRig({
  view,
  mode,
  resetKey,
  actionCamera,
  frame,
  preview,
}: SceneProps) {
  const controls = useRef<CameraControlsImpl>(null);
  const { size, camera } = useThree();
  const aspect = size.width / size.height;
  const mobile = aspect < 0.9;
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
    void c.setLookAt(...eye, ...framing.target, true);
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
      mouseButtons={{
        // Orbiting and zooming work immediately, without switching into
        // Look mode first — only the board-spin gesture (right mouse
        // button, freed up here so BoardObject can claim it in "play")
        // and screen-pan stay behind the explicit Look mode.
        left: mode === "rotate" ? ACTION.NONE : ACTION.ROTATE,
        middle: mode === "look" ? ACTION.DOLLY : ACTION.NONE,
        right: mode === "look" ? ACTION.TRUCK : ACTION.NONE,
        wheel: ACTION.DOLLY,
      }}
      touches={{
        one: mode === "rotate" ? ACTION.NONE : ACTION.TOUCH_ROTATE,
        two: mode === "look" ? ACTION.TOUCH_DOLLY_TRUCK : ACTION.NONE,
        three: ACTION.NONE,
      }}
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
  const moveSound = useRef<HTMLAudioElement>(null);
  const homeSound = useRef<HTMLAudioElement>(null);
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
  useEffect(() => {
    if (!soundEnabled) {
      moveSound.current?.pause();
      homeSound.current?.pause();
      moveSound.current = null;
      homeSound.current = null;
      return;
    }
    const audio = new Audio("/audio/ludo_piece_hopping_v2.wav");
    const homeAudio = new Audio("/audio/piece-home.wav");
    audio.preload = "auto";
    audio.volume = 0.46;
    homeAudio.preload = "auto";
    homeAudio.volume = 0.7;
    moveSound.current = audio;
    homeSound.current = homeAudio;
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      homeAudio.pause();
      homeAudio.removeAttribute("src");
      homeAudio.load();
      if (moveSound.current === audio) moveSound.current = null;
      if (homeSound.current === homeAudio) homeSound.current = null;
    };
  }, [soundEnabled]);
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
      if (
        m.elapsed >= m.delay &&
        arrivedStep > soundedStep.current &&
        moveSound.current
      ) {
        soundedStep.current = arrivedStep;
        const reachedHome =
          arrivedStep === m.points.length - 1 &&
          move?.pawnId === pawn.id &&
          move.finishesPawn;
        const sound = reachedHome ? homeSound.current : moveSound.current;
        if (sound) {
          sound.currentTime = 0;
          void sound.play().catch(() => {});
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
          if (clickable) {
            document.body.classList.remove("sim-piece-hover");
            setHovered(false);
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
          <ringGeometry args={[0.195, 0.218, 32]} />
          <meshBasicMaterial
            color="#ffdf94"
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
        {clickable && (
          <mesh position={[0, 0.12, 0]} visible={false}>
            <cylinderGeometry args={[0.24, 0.24, 0.26, 12]} />
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
const MOBILE_TWO_PLAYER_DIE_POINT: Point = [0, 0.26, 3.46];
const MOBILE_PLAYER_DIE_POINTS: Record<PlayerColor, Point> = {
  red: [-1.15, 0.26, -3.52],
  green: [1.15, 0.26, -3.52],
  yellow: [1.15, 0.26, 3.52],
  blue: [-1.15, 0.26, 3.52],
};
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
  const compact = useThree(
    ({ size }) => size.width <= 900 || size.height <= 650,
  );
  const activePlayer = players.find(
    (player) => player.id === (frame.actorId ?? turnPlayerId),
  );
  const snakes = gameType === "snakes_and_ladders";
  const followsPlayer = !snakes && (players.length === 4 || compact);
  const restingPoint = useMemo<Point>(() => {
    if (snakes) return SNAKES_DIE_POINT;
    if (!followsPlayer) return DESKTOP_DIE_POINT;
    if (compact && players.length === 2) return MOBILE_TWO_PLAYER_DIE_POINT;
    if (!activePlayer)
      return compact ? MOBILE_TWO_PLAYER_DIE_POINT : DESKTOP_DIE_POINT;
    return rotateTablePoint(
      (compact ? MOBILE_PLAYER_DIE_POINTS : DESKTOP_FOUR_PLAYER_DIE_POINTS)[
        activePlayer.color
      ],
      orientation,
    );
  }, [activePlayer, compact, followsPlayer, orientation, players.length, snakes]);
  const restingVector = useMemo(
    () => new THREE.Vector3(...restingPoint),
    [restingPoint],
  );
  const dieColor = "#ffffff";
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
    const active = hovered && canRoll && mode === "play";
    document.body.classList.toggle("sim-die-hover", active);
    return () => document.body.classList.remove("sim-die-hover");
  }, [canRoll, hovered, mode]);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    if (frame.rollId !== lastRoll.current) {
      lastRoll.current = frame.rollId;
      elapsed.current = 0;
    }
    elapsed.current += Math.min(delta, 0.1);
    const hoverScale = hovered && canRoll && mode === "play" ? 1.08 : 1;
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
      {!followsPlayer && (
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
          if (canRoll) onRoll();
        }}
        onPointerOver={(e) => {
          if (!canRoll || mode !== "play") return;
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
            transmission={compact ? 0.08 : 0.32}
            thickness={compact ? 0.3 : 0.82}
            ior={1.49}
            attenuationColor={dieColor}
            attenuationDistance={0.28}
            specularIntensity={1}
            specularColor="#ffffff"
            envMapIntensity={compact ? 4.2 : 3.4}
            transparent
            opacity={1}
            emissive={compact ? "#ffffff" : canRoll ? dieColor : "#000000"}
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

function BoardObject(props: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);
  const pieces = useRef<THREE.Group>(null);
  const snakeHeads = useRef<THREE.Group>(null);
  const targetFlip = props.gameType === "snakes_and_ladders" ? Math.PI : 0;
  const [initialFlip] = useState(targetFlip);
  const flip = useRef({ from: targetFlip, to: targetFlip, elapsed: 1.5 });
  const [initialRotation] = useState(props.orientation);
  const artwork = useTexture(boardArtwork.src);
  const classicArtwork = useTexture(classicBoardArtwork.src as string);
  const geometricArtwork = useTexture(geometricBoardArtwork.src as string);
  const aladdinArtwork = useTexture(aladdinBoardArtwork.src as string);
  const texture = useMemo(
    () => {
      const classic = props.boardStyle === "classic";
      const geometric = props.boardStyle === "geometric";
      const aladdin = props.boardStyle === "aladdin";
      return makeBoardTexture(
        classic ? classicArtwork : geometric ? geometricArtwork : aladdin ? aladdinArtwork : artwork,
        classic ? "full" : geometric ? "full" : aladdin ? "full" : "ludo",
        props.view === "overhead" ? 1.24 : 1,
      );
    },
    [artwork, classicArtwork, geometricArtwork, aladdinArtwork, props.boardStyle, props.view],
  );
  const snakeSource = useTexture(snakeArtwork.src as string);
  const snakeTexture = useMemo(() => makeBoardTexture(snakeSource, "full"), [snakeSource]);
  const wood = useTexture("/textures/board-wood.jpg");
  const drag = useRef<{ x: number; angle: number; pointer: number } | null>(
    null,
  );
  const angle = useRef(props.orientation);
  const dragging = useRef(false);
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
          <SnakeHeads />
        </group>
      )}
    </group>
  );
}

/**
 * The six snakes are baked into the static board texture — there's no live
 * body to re-animate — so "the snake is alive" comes from a small overlay
 * at each head: a gentle side-to-side weave plus a tongue that flicks out
 * and back on a loop. Positions/facing come straight from SNAKES + the
 * same snakeSquarePoint() pawns use, so they always land on the printed
 * head/tail squares regardless of board layout changes.
 */
const Z_AXIS = new THREE.Vector3(0, 0, 1);
function SnakeHeads() {
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
      Object.entries(SNAKES).map(([head, tail], i) => {
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
    [],
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
  };
  const mobileCornerPositions: Record<PlayerColor, Point> = {
    red: [-2.15, BOARD_Y, -3.52],
    green: [2.15, BOARD_Y, -3.52],
    yellow: [2.15, BOARD_Y, 3.52],
    blue: [-2.15, BOARD_Y, 3.52],
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
              [duelIndex === 0 ? -1.18 : 1.18, BOARD_Y, 3.46],
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
                <span className="seat-reaction">{reactions[player.id]}</span>
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
                    : player.status === "connected"
                      ? "At the table"
                      : "Reconnecting"}
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

export default function SimulatorScene(props: SceneProps) {
  const [performanceCap, setPerformanceCap] = useState(2);
  const shadowSize = { low: 512, medium: 1024, high: 2048, ultra: 4096 }[
    props.quality
  ];
  const dpr: { [K in Quality]: [number, number] } = {
    low: [1, 1],
    medium: [1, 1.25],
    high: [1, 1.75],
    ultra: [1, 2],
  };
  return (
    <div
      className={`sim-canvas mode-${props.mode}`}
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
        shadows={props.quality !== "low"}
        dpr={[1, Math.min(dpr[props.quality][1], performanceCap)]}
        camera={{ position: [0, 6.6, 8.4], fov: 42, near: 0.1, far: 120 }}
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
              turnPlayerId={props.turnPlayerId}
              speakingPlayerIds={props.speakingPlayerIds}
              preview={props.preview}
              orientation={props.orientation}
            />
          </Suspense>
          <BoardObject {...props} />
          <PhysicalDie key={props.frame.revision} {...props} />
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
        </Suspense>
        <CameraRig {...props} />
        <PerformanceMonitor
          bounds={() => [28, 55]}
          flipflops={3}
          onDecline={() => setPerformanceCap((cap) => Math.max(1, cap - 0.25))}
          onFallback={() => setPerformanceCap(1)}
        />
      </Canvas>
    </div>
  );
}
