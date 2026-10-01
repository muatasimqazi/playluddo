"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Point, Quality } from "@/lib/presentation/board";
import {
  Box,
  BoxInstances,
  canvasTexture,
  Fire,
  grain,
  makeOcclusionTextures,
  Occlusion,
  seeded,
} from "./roomParts";

/*
 * A log cabin on a lake: round-log walls, a river-stone hearth, a timber
 * ceiling, and a window wall onto the deck and the water. The same
 * footprint, seat positions and table height as the Apartment, so cameras,
 * seat figures and the board all land as they do there. Wood reuses the
 * Apartment's photographs recoloured; the rest is drawn here.
 */

const FLOOR_Y = -2.6;
const RUG_Y = -2.53;

const LOG = "#d39a5c";
const TIMBER = "#9a6236";
const DARK_TIMBER = "#6e4426";
const IRON = "#1e1d1b";
const CHINKING = "#cfc2a5";

/** One instanced log (or any cylinder): where, its radius and length, and which way it runs. */
type LogSpec = {
  at: Point;
  radius: number;
  length: number;
  axis: "x" | "y" | "z";
  colour?: string;
};

function Logs({
  logs,
  map,
  colour = "#ffffff",
  castShadow = false,
}: {
  logs: LogSpec[];
  map?: THREE.Texture;
  colour?: string;
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tinted = logs.some((log) => log.colour);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const c = new THREE.Color();
    logs.forEach(({ at, radius, length, axis, colour: tint }, i) => {
      euler.set(
        axis === "z" ? Math.PI / 2 : 0,
        0,
        axis === "x" ? Math.PI / 2 : 0,
      );
      rotation.setFromEuler(euler);
      matrix.compose(
        new THREE.Vector3(...at),
        rotation,
        new THREE.Vector3(radius, length, radius),
      );
      mesh.setMatrixAt(i, matrix);
      if (tinted) mesh.setColorAt(i, c.set(tint ?? colour));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [logs, tinted, colour]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, logs.length]}
      castShadow={castShadow}
      receiveShadow
    >
      <cylinderGeometry args={[1, 1, 1, 18]} />
      <meshStandardMaterial
        color={tinted ? "#ffffff" : colour}
        map={map}
        roughness={0.75}
      />
    </instancedMesh>
  );
}

/**
 * The log walls. Each wall's courses sit half a log higher or lower than its
 * neighbours', so they interleave and run past each other at the corners as
 * notched logs do. The window wall keeps a three-log knee wall; the back
 * wall's lowest courses stop either side of the firebox.
 */
function wallLogs(): LogSpec[] {
  const random = seeded(5);
  const radius = 0.45;
  const pitch = 0.84;
  const logs: LogSpec[] = [];
  const colour = () => {
    const shade = 0.88 + random() * 0.14;
    return new THREE.Color(1, 1, 1).multiplyScalar(shade).getStyle();
  };
  for (let k = 0; k < 20; k++) {
    const y = -2.15 + k * pitch;
    // Back wall, split round the firebox for the courses it would show through.
    if (y < 1.4) {
      logs.push({
        at: [-7.95, y, -13.6],
        radius,
        length: 12.3,
        axis: "x",
        colour: colour(),
      });
      logs.push({
        at: [7.95, y, -13.6],
        radius,
        length: 12.3,
        axis: "x",
        colour: colour(),
      });
    } else {
      logs.push({
        at: [0, y, -13.6],
        radius,
        length: 28.4,
        axis: "x",
        colour: colour(),
      });
    }
    logs.push({
      at: [0, y, 13.6],
      radius,
      length: 28.4,
      axis: "x",
      colour: colour(),
    });
    const side = y + pitch / 2;
    if (side < 14.3)
      logs.push({
        at: [13.4, side, 0],
        radius,
        length: 28.6,
        axis: "z",
        colour: colour(),
      });
    if (k < 3)
      logs.push({
        at: [-13.6, side, 0],
        radius,
        length: 28.6,
        axis: "z",
        colour: colour(),
      });
  }
  return logs;
}

/** Rounded river stones in mortar, colour and height: one repeat is 2.4 units. */
function makeStone() {
  const draw = (bump: boolean) =>
    canvasTexture(
      512,
      512,
      (ctx) => {
        const random = seeded(43);
        ctx.fillStyle = bump ? "#000" : "#7d766b";
        ctx.fillRect(0, 0, 512, 512);
        const stones = [
          "#8f8a82",
          "#a39d92",
          "#7a736a",
          "#9a8b78",
          "#b3aca0",
          "#6f6a63",
          "#a08f7a",
        ];
        // Rows of stones, wrapped at the edges so the texture tiles.
        for (let y = 0; y < 512; y += 46 + random() * 10) {
          for (let x = random() * 40; x < 512 + 60;) {
            const rx = 24 + random() * 30;
            const ry = 18 + random() * 10;
            const cx = x + rx;
            const cy = y + ry + (random() - 0.5) * 8;
            for (const ox of [-512, 0, 512]) {
              for (const oy of [-512, 0, 512]) {
                const g = ctx.createRadialGradient(
                  cx + ox - rx * 0.3,
                  cy + oy - ry * 0.4,
                  2,
                  cx + ox,
                  cy + oy,
                  rx,
                );
                if (bump) {
                  g.addColorStop(0, "#fff");
                  g.addColorStop(1, "#444");
                } else {
                  const base = stones[Math.floor(random() * stones.length)];
                  g.addColorStop(0, base);
                  g.addColorStop(1, "#5a554e");
                }
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.ellipse(
                  cx + ox,
                  cy + oy,
                  rx,
                  ry,
                  (random() - 0.5) * 0.5,
                  0,
                  Math.PI * 2,
                );
                ctx.fill();
              }
            }
            x += rx * 2 + 4;
          }
        }
        if (!bump) grain(ctx, 512, 512, 18, 47);
      },
      !bump,
    );
  return { map: draw(false), bump: draw(true) };
}

/** Buffalo check: red and black wool. */
function makePlaid() {
  const t = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#a3231f";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "rgba(20,14,12,0.55)";
    ctx.fillRect(0, 0, 128, 256);
    ctx.fillRect(0, 0, 256, 128);
    // Fine twill lines through the wool.
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    for (let i = -256; i < 256; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 256, 256);
      ctx.stroke();
    }
    grain(ctx, 256, 256, 22, 59);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A cream wool point-blanket rug: green, red, yellow and indigo bands near each end. */
function makeBlanketRug() {
  return canvasTexture(1040, 920, (ctx) => {
    ctx.fillStyle = "#e9e1cc";
    ctx.fillRect(0, 0, 1040, 920);
    const bands: [string, number][] = [
      ["#2f6b45", 34],
      ["#e9e1cc", 16],
      ["#b3282a", 34],
      ["#e9e1cc", 16],
      ["#e2b23a", 34],
      ["#e9e1cc", 16],
      ["#24315e", 34],
    ];
    for (const fromLeft of [true, false]) {
      let x = 90;
      for (const [colour, width] of bands) {
        ctx.fillStyle = colour;
        ctx.fillRect(fromLeft ? x : 1040 - x - width, 0, width, 920);
        x += width;
      }
    }
    // Woollen weave and the soft fuzz of a felted blanket.
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    for (let y = 0; y < 920; y += 3) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1040, y);
      ctx.stroke();
    }
    grain(ctx, 1040, 920, 22, 61);
  });
}

/** The lake from the cabin: morning sky, ranges, a pine shore, still water. */
function makeLake() {
  const W = 2048,
    H = 1024;
  return canvasTexture(W, H, (ctx) => {
    const random = seeded(79);
    const horizon = H * 0.555;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#6f98bf");
    sky.addColorStop(0.65, "#b9cbd6");
    sky.addColorStop(1, "#f1d4a8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);
    const sun = ctx.createRadialGradient(
      W * 0.7,
      horizon - 40,
      4,
      W * 0.7,
      horizon - 40,
      360,
    );
    sun.addColorStop(0, "rgba(255,240,205,0.9)");
    sun.addColorStop(1, "rgba(255,230,190,0)");
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, horizon);
    // Two ranges, the far one paler.
    const ridge = (
      base: number,
      amplitude: number,
      colour: string,
      seed: number,
    ) => {
      const r = seeded(seed);
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      let y = base;
      for (let x = 0; x <= W; x += 16) {
        y += (r() - 0.5) * amplitude;
        y = Math.min(horizon - 10, Math.max(base - 140, y));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, horizon);
      ctx.fill();
    };
    ridge(horizon - 150, 26, "#9aaabb", 83);
    ridge(horizon - 80, 22, "#73879a", 89);
    // Pine shore along the waterline.
    const pines = (ctx2: CanvasRenderingContext2D) => {
      const r = seeded(97);
      ctx2.fillStyle = "#24352a";
      ctx2.fillRect(0, horizon - 12, W, 14);
      for (let x = -10; x < W + 10; x += 7 + r() * 9) {
        const h = 30 + r() * 70;
        ctx2.beginPath();
        ctx2.moveTo(x, horizon - 10 - h);
        ctx2.lineTo(x + 9 + h * 0.12, horizon);
        ctx2.lineTo(x - 9 - h * 0.12, horizon);
        ctx2.fill();
      }
    };
    pines(ctx);
    // Water: the sky mirrored and deepened, the shore reflected, then ripples.
    const water = ctx.createLinearGradient(0, horizon, 0, H);
    water.addColorStop(0, "#c9c2b0");
    water.addColorStop(0.15, "#6d8ca5");
    water.addColorStop(1, "#24394a");
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, W, H - horizon);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.translate(0, horizon * 2);
    ctx.scale(1, -1);
    ctx.filter = "blur(3px)";
    pines(ctx);
    ctx.restore();
    ctx.filter = "none";
    for (let i = 0; i < 260; i++) {
      const y = horizon + 8 + Math.pow(random(), 1.6) * (H - horizon);
      const near = (y - horizon) / (H - horizon);
      ctx.fillStyle = `rgba(255,${235 + Math.round(random() * 20)},210,${0.08 + random() * 0.18})`;
      const x = random() * W;
      // Sun glitter gathers under the sun.
      const under = Math.abs(x - W * 0.7) < 220 ? 2.2 : 1;
      ctx.fillRect(
        x,
        y,
        (20 + random() * 90) * (0.4 + near) * under,
        1.5 + near * 2,
      );
    }
  });
}

/** Lacing for the snowshoes: rawhide in a lattice, transparent between. */
function makeLacing() {
  return canvasTexture(128, 256, (ctx) => {
    ctx.strokeStyle = "#c9a876";
    ctx.lineWidth = 3;
    for (let i = -256; i < 384; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 256);
      ctx.moveTo(i + 128, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
    }
  });
}

/** Rows of split logs stacked in an iron rack beside the hearth. */
function Woodpile({ bark }: { bark: THREE.Texture }) {
  const logs = useMemo(() => {
    const random = seeded(113);
    const out: LogSpec[] = [];
    for (let y = -2.3; y < 2.6;) {
      let rowTop = 0;
      for (let x = 5.0; x < 10.8;) {
        const r = 0.2 + random() * 0.12;
        out.push({
          at: [x + r, y + r, -12.55],
          radius: r,
          length: 0.95 + random() * 0.1,
          axis: "z",
          colour: ["#c9a27a", "#b48a5e", "#d7b48a", "#a07650"][
            Math.floor(random() * 4)
          ],
        });
        x += r * 2 + 0.02;
        rowTop = Math.max(rowTop, r * 2);
      }
      y += rowTop * 0.86;
    }
    return out;
  }, []);
  return (
    <group>
      <Logs logs={logs} map={bark} castShadow />
      {[4.85, 11.0].map((x) => (
        <Box
          key={x}
          position={[x, 0.3, -12.55]}
          size={[0.08, 5.8, 1.0]}
          color={IRON}
          metal={0.5}
          roughness={0.5}
        />
      ))}
      <Box
        position={[7.92, -2.45, -12.55]}
        size={[6.3, 0.08, 1.0]}
        color={IRON}
        metal={0.5}
        roughness={0.5}
      />
    </group>
  );
}

/**
 * River-stone chimney breast round the firebox, a raised stone hearth and a
 * log mantel. The opening matches the study's, so the same fire sits in it.
 */
function Hearth({
  stone,
  wood,
  reducedMotion,
}: {
  stone: { map: THREE.Texture; bump: THREE.Texture };
  wood: THREE.Texture;
  reducedMotion?: boolean;
}) {
  const pieces = useMemo(() => {
    // [centre, size] of each stone mass, each with its own texture repeat.
    const parts: [Point, Point][] = [
      [
        [-2.95, 5.95, -12.9],
        [2.5, 17.1, 1.3],
      ],
      [
        [2.95, 5.95, -12.9],
        [2.5, 17.1, 1.3],
      ],
      [
        [0, 7.7, -12.9],
        [3.4, 13.6, 1.3],
      ],
      [
        [0, -2.5, -11.6],
        [8.6, 0.2, 1.6],
      ],
    ];
    return parts.map(([at, size]) => {
      const map = stone.map.clone();
      const bump = stone.bump.clone();
      for (const t of [map, bump]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(
          Math.max(size[0], size[2]) / 2.4,
          Math.max(size[1], size[2]) / 2.4,
        );
      }
      return { at, size, map, bump };
    });
  }, [stone]);
  useEffect(
    () => () =>
      pieces.forEach(({ map, bump }) => (map.dispose(), bump.dispose())),
    [pieces],
  );
  return (
    <group>
      {pieces.map(({ at, size, map, bump }, i) => (
        <mesh key={i} position={at} castShadow receiveShadow>
          <boxGeometry args={size} />
          <meshStandardMaterial
            map={map}
            bumpMap={bump}
            bumpScale={4}
            roughness={0.92}
          />
        </mesh>
      ))}
      <Box
        position={[0, -0.85, -13.4]}
        size={[3.4, 3.5, 0.2]}
        color="#2a1d16"
        roughness={1}
      />
      {[-1.6, 1.6].map((x) => (
        <Box
          key={x}
          position={[x, -0.85, -12.9]}
          size={[0.2, 3.5, 1]}
          color="#24180f"
          roughness={1}
        />
      ))}
      <Box
        position={[0, 0.85, -12.9]}
        size={[3.4, 0.12, 1]}
        color="#130c08"
        roughness={1}
      />
      <Fire reducedMotion={reducedMotion} />
      {/* A rough-hewn log mantel on iron pins. */}
      <mesh
        position={[0, 2.75, -12.0]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[0.42, 0.42, 7.6, 18]} />
        <meshStandardMaterial color={TIMBER} map={wood} roughness={0.7} />
      </mesh>
      {/* On the mantel: a lantern, an enamel pot, a framed lake photograph. */}
      <Lantern position={[-2.8, 3.17, -12.0]} />
      <mesh position={[2.6, 3.42, -12.0]} castShadow>
        <cylinderGeometry args={[0.32, 0.36, 0.5, 20]} />
        <meshPhysicalMaterial
          color="#2c4a6b"
          roughness={0.25}
          clearcoat={0.9}
        />
      </mesh>
      <Box
        position={[0, 3.85, -12.2]}
        size={[1.6, 1.25, 0.08]}
        color={DARK_TIMBER}
        map={wood}
        rotation={[-0.12, 0, 0]}
      />
    </group>
  );
}

/** A kerosene lantern: tin base and cap, a glowing glass chimney, a wire bail. */
function Lantern({
  position,
  light = false,
}: {
  position: Point;
  light?: boolean;
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.2, 18]} />
        <meshStandardMaterial
          color="#8e2a20"
          metalness={0.5}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, 0.42, 0]} scale={[1, 1.35, 1]}>
        <sphereGeometry args={[0.2, 18, 14]} />
        <meshStandardMaterial
          color="#ffe8c2"
          emissive="#ffb35a"
          emissiveIntensity={1.4}
          transparent
          opacity={0.85}
          roughness={0.1}
        />
      </mesh>
      <mesh position={[0, 0.74, 0]}>
        <cylinderGeometry args={[0.1, 0.22, 0.12, 16]} />
        <meshStandardMaterial
          color="#8e2a20"
          metalness={0.5}
          roughness={0.45}
        />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <torusGeometry args={[0.26, 0.012, 6, 24, Math.PI]} />
        <meshStandardMaterial color={IRON} metalness={0.8} roughness={0.4} />
      </mesh>
      {light && (
        <pointLight
          position={[0, 0.45, 0]}
          color="#ffb870"
          intensity={2.5}
          distance={8}
          decay={2}
        />
      )}
    </group>
  );
}

/**
 * A log-frame seat: peeled-log rails, posts and arms, with deep cushions.
 * `seats` cushions across, facing -z; the back is a top log on spindles.
 */
function LogSeat({
  position,
  rotation,
  width,
  seats,
  wood,
  fabric,
  plaid,
  throwOn,
}: {
  position: Point;
  rotation: number;
  width: number;
  seats: number;
  wood: THREE.Texture;
  fabric: THREE.Texture;
  plaid: THREE.Texture;
  throwOn?: -1 | 1;
}) {
  const depth = 2.5;
  const half = width / 2;
  const logs = useMemo(() => {
    const r = 0.2;
    const out: LogSpec[] = [];
    // Corner posts: front ones to arm height, back ones to the top rail.
    for (const x of [-half + r, half - r]) {
      out.push({
        at: [x, 1.0, -depth / 2 + r],
        radius: r,
        length: 2.0,
        axis: "y",
      });
      out.push({
        at: [x, 1.55, depth / 2 - r],
        radius: r,
        length: 3.1,
        axis: "y",
      });
      out.push({ at: [x, 2.05, 0], radius: r, length: depth, axis: "z" }); // arm
      out.push({ at: [x, 0.55, 0], radius: 0.15, length: depth, axis: "z" }); // side rail
    }
    out.push({
      at: [0, 0.55, -depth / 2 + r],
      radius: 0.17,
      length: width,
      axis: "x",
    });
    out.push({
      at: [0, 0.55, depth / 2 - r],
      radius: 0.17,
      length: width,
      axis: "x",
    });
    out.push({
      at: [0, 3.0, depth / 2 - r],
      radius: 0.2,
      length: width,
      axis: "x",
    });
    for (let x = -half + 0.7; x < half - 0.5; x += 0.55) {
      out.push({
        at: [x, 1.9, depth / 2 - r],
        radius: 0.06,
        length: 2.1,
        axis: "y",
      });
    }
    return out;
  }, [half, width]);
  const cushion = (width - 0.8) / seats;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Logs logs={logs} map={wood} colour={LOG} castShadow />
      <Box
        position={[0, 0.72, 0]}
        size={[width - 0.5, 0.14, depth - 0.4]}
        color={DARK_TIMBER}
        map={wood}
      />
      {Array.from({ length: seats }, (_, i) => {
        const x = -half + 0.4 + cushion * (i + 0.5);
        return (
          <group key={i}>
            <RoundedBox
              args={[cushion - 0.06, 0.55, depth - 0.55]}
              radius={0.16}
              smoothness={4}
              position={[x, 1.07, -0.1]}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color="#cbbd9e"
                map={fabric}
                roughness={0.95}
                sheen={0.5}
                sheenRoughness={0.6}
                sheenColor="#e8ddc6"
              />
            </RoundedBox>
            <RoundedBox
              args={[cushion - 0.12, 1.5, 0.5]}
              radius={0.18}
              smoothness={4}
              position={[x, 2.05, 0.75]}
              rotation={[-0.12, 0, 0]}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color="#cbbd9e"
                map={fabric}
                roughness={0.95}
                sheen={0.5}
                sheenRoughness={0.6}
                sheenColor="#e8ddc6"
              />
            </RoundedBox>
          </group>
        );
      })}
      {/* A plaid wool cushion, and a throw folded over one arm. */}
      <RoundedBox
        args={[0.95, 0.85, 0.28]}
        radius={0.12}
        smoothness={4}
        position={[(throwOn ?? 1) * -(half - 0.95), 1.75, 0.35]}
        rotation={[-0.25, 0, (throwOn ?? 1) * 0.18]}
        castShadow
      >
        <meshStandardMaterial map={plaid} roughness={1} />
      </RoundedBox>
      {throwOn && (
        <group position={[throwOn * (half - 0.2), 0, 0]}>
          <Box
            position={[0, 2.3, 0.1]}
            size={[0.6, 0.08, 1.4]}
            color="#ffffff"
            map={plaid}
          />
          <Box
            position={[throwOn * 0.3, 1.5, 0.1]}
            size={[0.08, 1.6, 1.4]}
            color="#ffffff"
            map={plaid}
          />
        </group>
      )}
    </group>
  );
}

/** A thick plank slab on log legs; its top sits where every room's does. */
function SlabTable({ top, wood }: { top: THREE.Texture; wood: THREE.Texture }) {
  const legs = useMemo<LogSpec[]>(
    () => [
      ...[-3.5, 3.5].flatMap((x) =>
        [-3.0, 3.0].map((z) => ({
          at: [x, -1.47, z] as Point,
          radius: 0.32,
          length: 2.26,
          axis: "y" as const,
        })),
      ),
      { at: [-3.5, -2.0, 0], radius: 0.16, length: 6, axis: "z" },
      { at: [3.5, -2.0, 0], radius: 0.16, length: 6, axis: "z" },
      { at: [0, -2.0, 0], radius: 0.16, length: 7, axis: "x" },
    ],
    [],
  );
  return (
    <group>
      <Box
        position={[0, -0.19, 0]}
        size={[8.5, 0.36, 7.65]}
        color="#c9935a"
        map={top}
        roughness={0.55}
        clearcoat={0.3}
      />
      <Logs logs={legs} map={wood} colour={LOG} castShadow />
    </group>
  );
}

/** A cedar-strip canoe hung on the wall: a long hull, gunwales and thwarts. */
function Canoe({ wood }: { wood: THREE.Texture }) {
  return (
    <group position={[12.0, 9.4, 0]}>
      <mesh rotation={[0, 0, 0]} scale={[0.85, 0.55, 7]} castShadow>
        <sphereGeometry
          args={[1, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]}
        />
        <meshPhysicalMaterial
          color="#9b2f24"
          roughness={0.35}
          clearcoat={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[0.85, 7, 1]}>
        <torusGeometry args={[1, 0.035, 8, 64]} />
        <meshStandardMaterial color={TIMBER} map={wood} roughness={0.5} />
      </mesh>
      {[-2.5, 0, 2.5].map((z) => (
        <Box
          key={z}
          position={[0, 0, z]}
          size={[1.6 * Math.sqrt(1 - (z / 7) ** 2), 0.06, 0.18]}
          color={TIMBER}
          map={wood}
        />
      ))}
      {[-4, 4].map((z) => (
        <Box
          key={z}
          position={[0.55, -0.7, z]}
          size={[0.5, 0.12, 0.2]}
          color={IRON}
          metal={0.5}
        />
      ))}
    </group>
  );
}

function Paddle({
  position,
  tilt,
  wood,
}: {
  position: Point;
  tilt: number;
  wood: THREE.Texture;
}) {
  return (
    <group position={position} rotation={[0, Math.PI, tilt]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 3.4, 10]} />
        <meshStandardMaterial color={LOG} map={wood} roughness={0.5} />
      </mesh>
      <mesh position={[0, -1.4, 0]} scale={[0.42, 1.25, 0.06]} castShadow>
        <sphereGeometry args={[1, 18, 12]} />
        <meshPhysicalMaterial
          color={LOG}
          map={wood}
          roughness={0.4}
          clearcoat={0.5}
        />
      </mesh>
      <Box
        position={[0, 2.65, 0]}
        size={[0.32, 0.14, 0.1]}
        color={LOG}
        map={wood}
      />
    </group>
  );
}

function Snowshoe({
  position,
  tilt,
  lacing,
}: {
  position: Point;
  tilt: number;
  lacing: THREE.Texture;
}) {
  return (
    <group position={position} rotation={[0, Math.PI, tilt]}>
      <mesh scale={[0.6, 1.6, 1]}>
        <torusGeometry args={[1, 0.06, 8, 40]} />
        <meshStandardMaterial color="#b98a52" roughness={0.6} />
      </mesh>
      <mesh scale={[0.6, 1.6, 1]}>
        <circleGeometry args={[0.97, 32]} />
        <meshStandardMaterial
          map={lacing}
          transparent
          alphaTest={0.3}
          side={THREE.DoubleSide}
          roughness={0.8}
        />
      </mesh>
    </group>
  );
}

/** Wrought-iron ring chandelier with candle bulbs, hung from the centre beam. */
function IronChandelier() {
  const arms = 8;
  return (
    <group>
      <mesh position={[0, 12.7, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 1.6, 8]} />
        <meshStandardMaterial color={IRON} metalness={0.7} roughness={0.5} />
      </mesh>
      {[1.6, 1.0].map((r, i) => (
        <mesh
          key={r}
          position={[0, 11.9 + i * 0.25, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[r, 0.05, 8, 64]} />
          <meshStandardMaterial color={IRON} metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
      {Array.from({ length: arms }, (_, i) => {
        const a = (i / arms) * Math.PI * 2;
        const x = Math.cos(a) * 1.6,
          z = Math.sin(a) * 1.6;
        return (
          <group key={i}>
            <mesh
              position={[x * 0.5, 12.6, z * 0.5]}
              rotation={[0, -a, Math.PI / 2 - 0.55]}
            >
              <cylinderGeometry args={[0.02, 0.02, 1.9, 6]} />
              <meshStandardMaterial
                color={IRON}
                metalness={0.7}
                roughness={0.5}
              />
            </mesh>
            <mesh position={[x, 12.1, z]}>
              <cylinderGeometry args={[0.06, 0.06, 0.35, 10]} />
              <meshStandardMaterial color="#efe6d2" roughness={0.6} />
            </mesh>
            <mesh position={[x, 12.33, z]}>
              <sphereGeometry args={[0.065, 10, 8]} />
              <meshBasicMaterial color="#ffd99e" toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** The front door: vertical planks, iron strap hinges and a ring pull, in a log frame. */
function FrontDoor({ wood }: { wood: THREE.Texture }) {
  const z = 13.05;
  const x = -7;
  return (
    <group>
      <Box
        position={[x, 2.4, z]}
        size={[3.4, 10, 0.25]}
        color="#7a4f2e"
        map={wood}
        roughness={0.6}
      />
      {[-1.25, -0.42, 0.42, 1.25].map((dx) => (
        <Box
          key={dx}
          position={[x + dx, 2.4, z - 0.14]}
          size={[0.03, 9.9, 0.02]}
          color="#3e2716"
        />
      ))}
      {[-0.8, 3.0, 6.4].map((y) => (
        <Box
          key={y}
          position={[x + 0.6, y, z - 0.16]}
          size={[2.2, 0.22, 0.04]}
          color={IRON}
          metal={0.6}
          roughness={0.5}
        />
      ))}
      <mesh position={[x - 1.2, 2.2, z - 0.22]}>
        <torusGeometry args={[0.2, 0.035, 8, 24]} />
        <meshStandardMaterial color={IRON} metalness={0.7} roughness={0.45} />
      </mesh>
      {[-1.95, 1.95].map((dx) => (
        <Box
          key={dx}
          position={[x + dx, 2.5, z - 0.05]}
          size={[0.5, 10.4, 0.5]}
          color={TIMBER}
          map={wood}
        />
      ))}
      <Box
        position={[x, 7.7, z - 0.05]}
        size={[4.4, 0.6, 0.55]}
        color={TIMBER}
        map={wood}
      />
      {/* Braided rag mat. */}
      <mesh position={[x, -2.57, 11.6]} scale={[1.6, 1, 1.0]}>
        <cylinderGeometry args={[1, 1, 0.04, 40]} />
        <meshStandardMaterial color="#7d5a3c" roughness={1} />
      </mesh>
      {/* Pegs: a lantern and a coat. */}
      <Box
        position={[-1.8, 6.6, 13.1]}
        size={[3.4, 0.3, 0.12]}
        color={TIMBER}
        map={wood}
      />
      {[-3, -1.8, -0.6].map((px) => (
        <mesh
          key={px}
          position={[px, 6.6, 12.9]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
          <meshStandardMaterial color={DARK_TIMBER} />
        </mesh>
      ))}
    </group>
  );
}

/** The window wall: a timber frame of posts and a transom, onto the deck and the lake. */
function LakeWindows({
  lake,
  wood,
  deck,
}: {
  lake: THREE.Texture;
  wood: THREE.Texture;
  deck: THREE.Texture;
}) {
  const x = -13.35;
  const rail = useMemo<LogSpec[]>(() => {
    const out: LogSpec[] = [];
    for (let z = -13.5; z <= 13.5; z += 2.7)
      out.push({ at: [-20.4, -1.3, z], radius: 0.16, length: 3.2, axis: "y" });
    out.push({ at: [-20.4, 0.25, 0], radius: 0.18, length: 28, axis: "z" });
    out.push({ at: [-20.4, -1.3, 0], radius: 0.12, length: 28, axis: "z" });
    return out;
  }, []);
  return (
    <group>
      {/* Far shore and sky; outside the fog, which is for the room's own depth. */}
      <mesh position={[-70, 48.4 - 40, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[160, 80]} />
        <meshBasicMaterial map={lake} toneMapped={false} fog={false} />
      </mesh>
      {/* The deck and its log railing. */}
      <Box
        position={[-17.2, -2.85, 0]}
        size={[7.4, 0.2, 30]}
        color="#a48862"
        map={deck}
        roughness={0.85}
      />
      <Logs logs={rail} map={wood} colour={LOG} />
      {/* Timber posts and a transom; glass between. */}
      {[-13.6, -6.8, 0, 6.8, 13.6].map((z) => (
        <Box
          key={z}
          position={[x, 7.45, z]}
          size={[0.45, 14.1, 0.45]}
          color={TIMBER}
          map={wood}
          roughness={0.6}
        />
      ))}
      <Box
        position={[x, 10.2, 0]}
        size={[0.45, 0.4, 28]}
        color={TIMBER}
        map={wood}
        roughness={0.6}
      />
      <Box
        position={[x + 0.1, 0.48, 0]}
        size={[0.7, 0.16, 28]}
        color={TIMBER}
        map={wood}
        roughness={0.5}
      />
      <mesh
        position={[x + 0.02, 7.45, 0]}
        rotation={[0, Math.PI / 2, 0]}
        renderOrder={2}
      >
        <planeGeometry args={[28, 14.1]} />
        <meshStandardMaterial
          color="#dfe8ea"
          transparent
          opacity={0.08}
          metalness={0.3}
          roughness={0.05}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

const CABIN_FLOOR_SHADES: [number, number, number, number, number, number][] = [
  [0, RUG_Y, -6.3, 9.4, 2.5, 0.7], // sofa
  [0, RUG_Y, 6.2, 2.6, 2.5, 0.65], // armchairs
  [-6.2, RUG_Y, 0, 2.5, 2.6, 0.65],
  [6.2, RUG_Y, 0, 2.5, 2.6, 0.65],
  [0, RUG_Y, 0, 8, 7.2, 0.3], // under the table
  [7.9, FLOOR_Y, -12.55, 6.2, 1.0, 0.55], // woodpile
  [-8.4, FLOOR_Y, -12.6, 7, 0.9, 0.5], // shelves
  [12.35, FLOOR_Y, 0, 1.0, 5.2, 0.5], // console
];

/** Rough plank shelves left of the hearth: books, jars, a lantern. */
function Shelves({ wood }: { wood: THREE.Texture }) {
  const items = useMemo(() => {
    const random = seeded(127);
    const boxes: [Point, Point][] = [];
    const colours: string[] = [];
    for (const y of [1.15, 3.65, 6.15]) {
      for (let x = -11.7; x < -5.4;) {
        if (random() < 0.7) {
          const w = 0.14 + random() * 0.2;
          const h = 0.9 + random() * 0.55;
          boxes.push([
            [x + w / 2, y + h / 2, -12.75],
            [w, h, 0.75],
          ]);
          colours.push(
            ["#6b2a1f", "#2f4a33", "#2a3550", "#8a6a3e", "#4a3324", "#9a8456"][
              Math.floor(random() * 6)
            ],
          );
          x += w + 0.01;
        } else x += 0.6 + random() * 0.6;
      }
    }
    return { boxes, colours };
  }, []);
  return (
    <group>
      {[1.1, 3.6, 6.1, 8.6].map((y) => (
        <Box
          key={y}
          position={[-8.6, y - 0.08, -12.7]}
          size={[6.8, 0.16, 1.0]}
          color={TIMBER}
          map={wood}
          roughness={0.7}
        />
      ))}
      {[-11.9, -5.3].map((x) => (
        <Box
          key={x}
          position={[x, 3.0, -12.7]}
          size={[0.25, 11.2, 1.0]}
          color={TIMBER}
          map={wood}
          roughness={0.7}
        />
      ))}
      <BoxInstances boxes={items.boxes} colors={items.colours}>
        <meshStandardMaterial color="#ffffff" roughness={0.75} />
      </BoxInstances>
      <Lantern position={[-6.2, 8.6, -12.6]} />
      {[-10.6, -9.9, -9.2].map((x, i) => (
        <mesh key={x} position={[x, 8.6 + 0.35, -12.6]}>
          <cylinderGeometry args={[0.22, 0.22, 0.7 - i * 0.1, 16]} />
          <meshStandardMaterial
            color="#d9e2dc"
            transparent
            opacity={0.45}
            roughness={0.05}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** A plank console under the canoe, with a lit lantern and a stack of books. */
function Console({ wood, light }: { wood: THREE.Texture; light: boolean }) {
  const legs = useMemo<LogSpec[]>(
    () =>
      [-2.3, 2.3].flatMap((z) =>
        [12.0, 12.7].map((x) => ({
          at: [x, -1.2, z] as Point,
          radius: 0.13,
          length: 2.8,
          axis: "y" as const,
        })),
      ),
    [],
  );
  return (
    <group>
      <Box
        position={[12.35, 0.27, 0]}
        size={[1.1, 0.2, 5.2]}
        color={TIMBER}
        map={wood}
        roughness={0.6}
        clearcoat={0.2}
      />
      <Logs logs={legs} map={wood} colour={LOG} castShadow />
      <Lantern position={[12.35, 0.37, -1.6]} light={light} />
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          position={[12.35, 0.45 + i * 0.16, 1.4]}
          size={[0.9, 0.15, 1.2 - i * 0.1]}
          color={["#6b2a1f", "#2f4a33", "#8a6a3e"][i]}
          rotation={[0, i * 0.15, 0]}
        />
      ))}
    </group>
  );
}

export function LakeCabin({
  quality,
  reducedMotion,
}: {
  quality: Quality;
  reducedMotion?: boolean;
}) {
  const anisotropy = quality === "low" ? 2 : 8;
  const [woodSource, floorSource, topSource, fabricSource] = useTexture([
    "/textures/board-wood.webp",
    "/textures/floor.jpg",
    "/textures/table-top.webp",
    "/textures/couch-fabric.webp",
  ]);
  const t = useMemo(() => {
    const prepare = (source: THREE.Texture, repeat?: [number, number]) => {
      const tex = source.clone();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = anisotropy;
      if (repeat) {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(...repeat);
      }
      return tex;
    };
    const plaid = makePlaid();
    plaid.repeat.set(2, 2);
    const stone = makeStone();
    return {
      wood: prepare(woodSource),
      logs: prepare(woodSource, [2, 6]),
      floor: prepare(floorSource, [4, 4]),
      ceiling: prepare(floorSource, [5, 5]),
      deck: prepare(floorSource, [2, 6]),
      top: prepare(topSource),
      fabric: prepare(fabricSource, [1.5, 1.5]),
      plaid,
      stoneMap: stone.map,
      stoneBump: stone.bump,
      rug: makeBlanketRug(),
      lake: makeLake(),
      lacing: makeLacing(),
      ...makeOcclusionTextures(),
    };
  }, [woodSource, floorSource, topSource, fabricSource, anisotropy]);
  useEffect(() => () => Object.values(t).forEach((tex) => tex.dispose()), [t]);
  const stone = useMemo(() => ({ map: t.stoneMap, bump: t.stoneBump }), [t]);
  const logs = useMemo(() => wallLogs(), []);
  const beams = useMemo<LogSpec[]>(
    () =>
      [-10, -5, 0, 5, 10].map((z) => ({
        at: [0, 14.0, z] as Point,
        radius: 0.42,
        length: 27.2,
        axis: "x" as const,
      })),
    [],
  );
  return (
    <group>
      {/* Wide pine boards, then the wool rug under the table. */}
      <Box
        position={[0, -2.73, 0]}
        size={[27, 0.25, 28]}
        color="#c08e5c"
        map={t.floor}
        roughness={0.5}
        clearcoat={0.2}
      />
      <Box
        position={[0, -2.57, 0]}
        size={[13, 0.065, 11.5]}
        color="#ffffff"
        map={t.rug}
        roughness={1}
      />

      {/* Chinking behind the logs, then the logs; a boarded ceiling on log beams. */}
      <Box
        position={[0, 6, -13.95]}
        size={[27.6, 17.2, 0.2]}
        color={CHINKING}
        roughness={0.95}
      />
      <Box
        position={[0, 6, 13.95]}
        size={[27.6, 17.2, 0.2]}
        color={CHINKING}
        roughness={0.95}
      />
      <Box
        position={[13.75, 6, 0]}
        size={[0.2, 17.2, 28]}
        color={CHINKING}
        roughness={0.95}
      />
      <Logs logs={logs} map={t.logs} colour={LOG} />
      <Box
        position={[0, 14.65, 0]}
        size={[27.6, 0.25, 28.4]}
        color="#d6a56c"
        map={t.ceiling}
        roughness={0.7}
      />
      <Logs logs={beams} map={t.logs} colour={LOG} castShadow />
      <IronChandelier />

      <Hearth stone={stone} wood={t.wood} reducedMotion={reducedMotion} />
      <Woodpile bark={t.wood} />
      <Shelves wood={t.wood} />
      <LakeWindows lake={t.lake} wood={t.wood} deck={t.deck} />
      <Canoe wood={t.wood} />
      <Console wood={t.wood} light={quality !== "low"} />
      <FrontDoor wood={t.wood} />
      <Paddle position={[2.6, 7.5, 13.05]} tilt={0.45} wood={t.wood} />
      <Paddle position={[4.2, 7.5, 13.05]} tilt={-0.45} wood={t.wood} />
      <Snowshoe position={[8.2, 7.2, 13.05]} tilt={0.12} lacing={t.lacing} />
      <Snowshoe position={[9.8, 7.0, 13.05]} tilt={-0.08} lacing={t.lacing} />

      {/* The party's sofa, chairs and table. */}
      <LogSeat
        position={[0, FLOOR_Y, -6.3]}
        // Its back is at local +z, away from the table once turned.
        rotation={Math.PI}
        width={9.4}
        seats={3}
        wood={t.logs}
        fabric={t.fabric}
        plaid={t.plaid}
        throwOn={1}
      />
      <LogSeat
        position={[0, FLOOR_Y, 6.2]}
        rotation={0}
        width={2.6}
        seats={1}
        wood={t.logs}
        fabric={t.fabric}
        plaid={t.plaid}
      />
      <LogSeat
        position={[-6.2, FLOOR_Y, 0]}
        rotation={-Math.PI / 2}
        width={2.6}
        seats={1}
        wood={t.logs}
        fabric={t.fabric}
        plaid={t.plaid}
        throwOn={-1}
      />
      <LogSeat
        position={[6.2, FLOOR_Y, 0]}
        rotation={Math.PI / 2}
        width={2.6}
        seats={1}
        wood={t.logs}
        fabric={t.fabric}
        plaid={t.plaid}
      />
      <SlabTable top={t.top} wood={t.logs} />

      {/* Daylight off the lake, and shade into corners and under furniture. */}
      <Occlusion
        map={t.edge}
        position={[-10.4, -2.6, 0]}
        size={[28, 5.6]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        opacity={0.22}
        light
      />
      <Occlusion
        map={t.edge}
        position={[0, -2.6, -12.6]}
        size={[27, 1.2]}
        opacity={0.42}
      />
      <Occlusion
        map={t.edge}
        position={[12.4, -2.6, 0]}
        size={[28, 1.2]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        opacity={0.42}
      />
      <Occlusion
        map={t.edge}
        position={[0, -2.6, 12.6]}
        size={[27, 1.2]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
        opacity={0.42}
      />
      {CABIN_FLOOR_SHADES.map(([x, y, z, w, d, opacity], i) => (
        <Occlusion
          key={i}
          map={t.blob}
          position={[x, y, z]}
          size={[w / 0.7, d / 0.7]}
          opacity={opacity}
        />
      ))}
    </group>
  );
}
