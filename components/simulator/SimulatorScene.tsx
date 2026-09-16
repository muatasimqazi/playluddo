"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import type { Pawn, Player } from "@/lib/board/types";
import { tileIdToPathIndex } from "@/lib/board/geometry";
import {
  BOARD_SIZE,
  BOARD_Y,
  COLORS,
  HOP_MS,
  ROLL_MS,
  moveWaypoints,
  pawnPoint,
  shortestAngle,
  type ActionCamera,
  type CameraView,
  type InteractionMode,
  type Point,
  type Quality,
} from "@/lib/presentation/board";
import type { PresentationFrame } from "@/lib/presentation/timeline";
import { cameraFraming } from "@/lib/presentation/camera";
import boardArtwork from "@/designs/board-design.png";
import { makeBoardTexture } from "./textures";
import { Apartment } from "./Apartment";
import { GlassPawn, GLASS_PAWN_HEIGHT } from "./GlassPawn";

export interface SceneProps {
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
  preview?: boolean;
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
        left: mode === "look" ? ACTION.ROTATE : ACTION.NONE,
        middle: mode === "look" ? ACTION.DOLLY : ACTION.NONE,
        right: mode === "look" ? ACTION.TRUCK : ACTION.NONE,
        wheel: mode === "look" ? ACTION.DOLLY : ACTION.NONE,
      }}
      touches={{
        one: mode === "look" ? ACTION.TOUCH_ROTATE : ACTION.NONE,
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
}: {
  pawn: Pawn;
  allPawns: Pawn[];
  legal: boolean;
  onMove: (id: string) => void;
  move: PresentationFrame["move"];
  mode: InteractionMode;
}) {
  const ref = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const previous = useRef(pawn);
  const motion = useRef<{
    points: Point[];
    elapsed: number;
    delay: number;
  } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [initial] = useState(() => pawnPoint(pawn));
  const stack = allPawns
    .filter(
      (p) =>
        p.pathIndex !== null &&
        pawn.pathIndex !== null &&
        pawnPoint(p)[0] === pawnPoint(pawn)[0] &&
        pawnPoint(p)[2] === pawnPoint(pawn)[2],
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const stackIndex = stack.findIndex((p) => p.id === pawn.id);
  const offset: Point =
    stack.length > 1
      ? [
          ((stackIndex % 2) - 0.5) * 0.025,
          stackIndex * (GLASS_PAWN_HEIGHT + 0.006),
          ((Math.floor(stackIndex / 2) % 2) - 0.5) * 0.025,
        ]
      : [0, 0, 0];
  useEffect(() => {
    const from = previous.current;
    if (from.pathIndex !== pawn.pathIndex) {
      const isCapture = pawn.pathIndex === null;
      const moved = allPawns.find((p) => p.id === move?.pawnId);
      const start =
        moved && move?.fromTileId
          ? tileIdToPathIndex(moved.color, move.fromTileId)
          : null;
      const movingSteps =
        start === null ? 1 : Math.max(1, (moved?.pathIndex ?? start) - start);
      motion.current = {
        points: [
          ref.current
            ? (ref.current.position.toArray() as Point)
            : pawnPoint(from),
          ...moveWaypoints(from, pawn),
        ],
        elapsed: 0,
        delay: isCapture ? (movingSteps * HOP_MS) / 1000 : 0,
      };
    }
    previous.current = pawn;
  }, [pawn, allPawns, move]);
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    const m = motion.current;
    if (m) {
      m.elapsed += Math.min(delta, 0.1);
      const t = Math.max(0, m.elapsed - m.delay) / (HOP_MS / 1000),
        index = Math.floor(t);
      if (index >= m.points.length - 1) {
        const p = pawnPoint(pawn);
        ref.current.position.set(
          p[0] + offset[0],
          p[1] + offset[1],
          p[2] + offset[2],
        );
        motion.current = null;
      } else {
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
          THREE.MathUtils.lerp(a[1], b[1], e) + Math.sin(f * Math.PI) * 0.1,
          THREE.MathUtils.lerp(a[2], b[2], e),
        );
      }
    } else {
      const p = pawnPoint(pawn);
      ref.current.position.set(
        p[0] + offset[0],
        p[1] + offset[1],
        p[2] + offset[2],
      );
    }
    ref.current.scale.setScalar(hovered && legal ? 1.12 : 1);
    if (ring.current) {
      ring.current.visible = legal;
      ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.1);
    }
  });
  const clickable = legal && mode === "play";
  return (
    <group
      ref={ref}
      position={initial}
      onPointerDown={(e) => {
        if (mode === "play") e.stopPropagation();
      }}
      onClick={(e) => {
        if (mode !== "play") return;
        e.stopPropagation();
        if (clickable) onMove(pawn.id);
      }}
      onPointerOver={(e) => {
        if (!clickable) return;
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <GlassPawn color={pawn.color} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.009, 0]}>
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

function PhysicalDie({
  frame,
  canRoll,
  onRoll,
  mode,
}: Pick<SceneProps, "frame" | "canRoll" | "onRoll" | "mode">) {
  const mesh = useRef<THREE.Group>(null);
  const elapsed = useRef(ROLL_MS / 1000);
  const target = useMemo(
    () =>
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(...DIE_ROTATION[frame.dice]),
      ),
    [frame.dice],
  );
  const lastRoll = useRef(frame.rollId);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    if (frame.rollId !== lastRoll.current) {
      lastRoll.current = frame.rollId;
      elapsed.current = 0;
    }
    elapsed.current += Math.min(delta, 0.1);
    const t = Math.min(1, elapsed.current / (ROLL_MS / 1000));
    if (t < 0.7) {
      mesh.current.rotation.x += delta * 17;
      mesh.current.rotation.z += delta * 13;
      mesh.current.position.set(
        3.65 + Math.sin(t * 9) * 0.12,
        0.26 + Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t) * 0.85,
        1.1 + (1 - t) * 0.4,
      );
    } else {
      mesh.current.quaternion.slerp(target, 1 - Math.exp(-delta * 24));
      mesh.current.position.lerp(
        new THREE.Vector3(3.65, 0.26, 1.1),
        1 - Math.exp(-delta * 24),
      );
      if (t === 1) {
        mesh.current.quaternion.copy(target);
        mesh.current.position.set(3.65, 0.26, 1.1);
      }
    }
  });
  return (
    <group>
      <RoundedBox
        args={[0.92, 0.055, 1.55]}
        radius={0.02}
        position={[3.65, 0.028, 1.1]}
      >
        <meshStandardMaterial color="#5b6550" roughness={0.9} />
      </RoundedBox>
      <group
        ref={mesh}
        position={[3.65, 0.26, 1.1]}
        onPointerDown={(e) => {
          if (mode === "play") e.stopPropagation();
        }}
        onClick={(e) => {
          if (mode !== "play") return;
          e.stopPropagation();
          if (canRoll) onRoll();
        }}
      >
        <RoundedBox
          args={[0.46, 0.46, 0.46]}
          radius={0.055}
          smoothness={4}
          castShadow
        >
          <meshPhysicalMaterial
            color="#fff5da"
            roughness={0.24}
            clearcoat={1}
            emissive={canRoll ? "#d8af61" : "#000000"}
            emissiveIntensity={0.18}
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
                <meshStandardMaterial color="#353b31" roughness={0.6} />
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
  const [initialRotation] = useState(props.orientation);
  const artwork = useTexture(boardArtwork.src);
  const texture = useMemo(() => makeBoardTexture(artwork), [artwork]);
  const wood = useTexture("/textures/board-wood.jpg");
  const drag = useRef<{ x: number; angle: number; pointer: number } | null>(
    null,
  );
  const angle = useRef(props.orientation);
  const dragging = useRef(false);
  useEffect(() => () => texture.dispose(), [texture]);
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
  });
  function down(e: ThreeEvent<PointerEvent>) {
    if (props.mode !== "rotate") return;
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
      <RoundedBox
        args={[6.36, 0.17, 6.36]}
        radius={0.065}
        position={[0, 0.1, 0]}
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
      <mesh position={[0, BOARD_Y - 0.008, 0]} receiveShadow>
        <boxGeometry args={[BOARD_SIZE, 0.018, BOARD_SIZE]} />
        <meshPhysicalMaterial
          map={texture}
          // Preserve printed ink hues; the room's filmic curve fades green/yellow.
          toneMapped={false}
          color="#cccccc"
          roughness={0.68}
          clearcoat={0.1}
          clearcoatRoughness={0.65}
          specularIntensity={0.2}
          envMapIntensity={0.35}
        />
      </mesh>
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <mesh
            key={`${x}:${z}`}
            position={[x * 3.09, 0.19, z * 3.09]}
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
      {props.frame.pawns.map((pawn) => (
        <Piece
          key={`${props.frame.revision}:${pawn.id}`}
          pawn={pawn}
          allPawns={props.frame.pawns}
          legal={props.legalPawnIds.includes(pawn.id)}
          mode={props.mode}
          move={props.frame.move}
          onMove={props.onMove}
        />
      ))}
    </group>
  );
}

function Seats({
  players,
  myPlayerId,
  turnPlayerId,
  frame,
  reactions,
  preview,
}: SceneProps) {
  if (preview) return null;
  const local = players.find((p) => p.id === myPlayerId)?.seatIndex ?? 0;
  const positions: Point[] = [
    [-2.5, 0.5, 3.45],
    [-4.65, 0.8, 0],
    [2.4, 0.7, -3.7],
    [4.65, 0.8, 0],
  ];
  return (
    <>
      {players.map((player) => {
        const relative = (player.seatIndex - local + 4) % 4;
        const active = player.id === (frame.actorId ?? turnPlayerId);
        return (
          <Html
            key={player.id}
            position={positions[relative]}
            center
            calculatePosition={(object, camera, size) => {
              const point = new THREE.Vector3()
                .setFromMatrixPosition(object.matrixWorld)
                .project(camera);
              const portrait = size.width / size.height < 0.9;
              const inset = portrait
                ? relative === 0 || relative === 2
                  ? 75
                  : 28
                : 120;
              return [
                THREE.MathUtils.clamp(
                  ((point.x + 1) * size.width) / 2,
                  inset,
                  size.width - inset,
                ),
                THREE.MathUtils.clamp(
                  ((1 - point.y) * size.height) / 2,
                  portrait ? 165 : 95,
                  size.height - (portrait ? 140 : 95),
                ),
              ];
            }}
            zIndexRange={[20, 10]}
            style={{ pointerEvents: "none" }}
          >
            <div
              className={`sim-seat ${active ? "is-active" : ""} seat-${relative}`}
              style={
                { "--seat-color": COLORS[player.color] } as React.CSSProperties
              }
            >
              {reactions?.[player.id] && (
                <span className="seat-reaction">{reactions[player.id]}</span>
              )}
              <span className="seat-avatar">
                {player.displayName.slice(0, 1).toUpperCase()}
              </span>
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
                    {
                      frame.pawns.filter(
                        (p) =>
                          p.color === player.color && p.state === "finished",
                      ).length
                    }
                    /4 home
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
    <div className={`sim-canvas mode-${props.mode}`}>
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
            A physical 3D Ludo table. Use the controls below to roll and select
            a legal piece. If the table is not visible, enable WebGL in your
            browser.
          </div>
        }
      >
        <color attach="background" args={["#d4ddd4"]} />
        <fog attach="fog" args={["#d4ddd4", 32, 85]} />
        <hemisphereLight args={["#e9f2ed", "#756854", 1.8]} />
        <directionalLight
          position={[-9, 10, 3]}
          intensity={3.2}
          color="#fff0d5"
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
          color="#ffe0b4"
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
              color="#eaf1ec"
            />
            <Lightformer
              position={[0, 8, 0]}
              scale={[10, 8]}
              rotation={[Math.PI / 2, 0, 0]}
              intensity={1.3}
              color="#ffe6bf"
            />
          </Environment>
          <Apartment quality={props.quality} />
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
          <Seats {...props} />
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
