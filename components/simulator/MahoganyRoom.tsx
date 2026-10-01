"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Point, Quality } from "@/lib/presentation/board";
import { Box, makeOcclusionTextures, Occlusion } from "./roomParts";

/*
 * A panelled mahogany study: the same footprint, seat positions and table
 * height as the Apartment, so the cameras, seat figures and board all land
 * exactly as they do there. Wood, floor and upholstery reuse the Apartment's
 * photographic textures recoloured; leather, marble, the rug and the dusk
 * outside are drawn here, so the room ships no new image files.
 */

// The room's shell, shared with the Apartment.
const FLOOR_Y = -2.6;
const CEILING_Y = 14.525;
const RUG_Y = -2.53;

// Polished mahogany over each source photo's own wood tone.
const MAHOGANY = "#a0604a";
const MAHOGANY_DARK = "#763f2e";
const LEATHER = "#6d2219";
const BRASS = "#b48a4e";

/** Deterministic, so the room is the same room on every mount and device. */
function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function canvasTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  color = true,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the study's textures.");
  paint(ctx);
  const t = new THREE.CanvasTexture(canvas);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function grain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  seed: number,
) {
  const random = seeded(seed);
  const pixels = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const n = (random() - 0.5) * amount;
    pixels.data[i] += n;
    pixels.data[i + 1] += n;
    pixels.data[i + 2] += n;
  }
  ctx.putImageData(pixels, 0, 0);
}

/** Grey leather hide (multiplied into the leather colour): soft mottling and pores. */
function makeLeather() {
  const t = canvasTexture(512, 512, (ctx) => {
    const random = seeded(11);
    ctx.fillStyle = "#c4c4c4";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 90; i++) {
      const x = random() * 512,
        y = random() * 512,
        r = 20 + random() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const light = random() > 0.5;
      g.addColorStop(0, light ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    grain(ctx, 512, 512, 22, 5);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Deep-buttoned Chesterfield leather: a diamond lattice of creases running
 * between buttons, each diamond puffed lighter in the middle. Tiles cleanly.
 */
function makeTufted() {
  const t = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#a9a9a9";
    ctx.fillRect(0, 0, 256, 256);
    for (const [x, y] of [
      [128, 0],
      [0, 128],
      [256, 128],
      [128, 256],
    ]) {
      const g = ctx.createRadialGradient(x, y, 4, x, y, 96);
      g.addColorStop(0, "rgba(255,255,255,0.42)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    ctx.filter = "blur(3px)";
    ctx.strokeStyle = "rgba(20,20,20,0.6)";
    ctx.lineWidth = 5;
    for (const [a, b, c, d] of [
      [0, 0, 256, 256],
      [256, 0, 0, 256],
      [-128, 128, 128, -128],
      [128, 384, 384, 128],
      [-128, 128, 128, 384],
      [128, -128, 384, 128],
    ]) {
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(c, d);
      ctx.stroke();
    }
    ctx.filter = "none";
    ctx.fillStyle = "#2a2a2a";
    for (const [x, y] of [
      [0, 0],
      [256, 0],
      [0, 256],
      [256, 256],
      [128, 128],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, 256, 256, 18, 9);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Honed Carrara: warm white with soft grey veins. */
function makeMarble() {
  const t = canvasTexture(512, 512, (ctx) => {
    const random = seeded(23);
    ctx.fillStyle = "#eee8de";
    ctx.fillRect(0, 0, 512, 512);
    ctx.lineCap = "round";
    for (let v = 0; v < 14; v++) {
      const major = v < 5;
      ctx.filter = major ? "blur(1.5px)" : "blur(0.8px)";
      ctx.strokeStyle = major
        ? "rgba(105,98,92,0.38)"
        : "rgba(120,112,104,0.22)";
      ctx.lineWidth = major ? 2.5 + random() * 3 : 1;
      let x = random() * 512,
        y = -20;
      let angle = Math.PI / 2 + (random() - 0.5) * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      while (y < 540 && x > -40 && x < 552) {
        angle += (random() - 0.5) * 0.7;
        angle = THREE.MathUtils.clamp(angle, 0.3, Math.PI - 0.3);
        x += Math.cos(angle) * 14;
        y += Math.sin(angle) * 14;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.filter = "none";
    grain(ctx, 512, 512, 6, 3);
  });
  return t;
}

/**
 * A hand-knotted Persian rug: madder-red field with an indigo lattice, an
 * ivory-and-indigo central medallion, corner spandrels and a guarded border,
 * then wool texture and the faint row-to-row colour drift (abrash) of real
 * hand-dyed yarn.
 */
function makeRug() {
  const W = 1040,
    H = 920;
  return canvasTexture(W, H, (ctx) => {
    const random = seeded(31);
    const red = "#6e1a17",
      indigo = "#1c2440",
      ivory = "#c9b48e",
      gold = "#9c733d";
    ctx.fillStyle = red;
    ctx.fillRect(0, 0, W, H);

    // Field lattice of small indigo diamonds with gold centres.
    const field = { x: 120, y: 120, w: W - 240, h: H - 240 };
    for (let y = field.y + 30; y < field.y + field.h; y += 60) {
      for (
        let x = field.x + 30 + ((y / 60) % 2) * 30;
        x < field.x + field.w;
        x += 60
      ) {
        ctx.fillStyle = indigo;
        ctx.beginPath();
        ctx.moveTo(x, y - 14);
        ctx.lineTo(x + 10, y);
        ctx.lineTo(x, y + 14);
        ctx.lineTo(x - 10, y);
        ctx.fill();
        ctx.fillStyle = gold;
        ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      }
    }

    // Central medallion: stacked stars, alternating colours.
    const star = (
      cx: number,
      cy: number,
      r: number,
      points: number,
      inset: number,
      fill: string,
    ) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < points * 2; i++) {
        const a = (i / (points * 2)) * Math.PI * 2;
        const rr = i % 2 ? r * inset : r;
        ctx.lineTo(cx + Math.cos(a) * rr * 1.35, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    };
    const cx = W / 2,
      cy = H / 2;
    star(cx, cy, 210, 16, 0.84, indigo);
    star(cx, cy, 180, 16, 0.84, ivory);
    star(cx, cy, 145, 12, 0.8, red);
    star(cx, cy, 110, 12, 0.8, indigo);
    star(cx, cy, 70, 8, 0.7, gold);
    star(cx, cy, 34, 8, 0.6, red);

    // Corner spandrels: quarter medallions.
    for (const [x, y] of [
      [field.x, field.y],
      [field.x + field.w, field.y],
      [field.x, field.y + field.h],
      [field.x + field.w, field.y + field.h],
    ]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(field.x, field.y, field.w, field.h);
      ctx.clip();
      star(x, y, 150, 12, 0.85, indigo);
      star(x, y, 120, 12, 0.85, ivory);
      star(x, y, 90, 10, 0.8, red);
      ctx.restore();
    }

    // Border: ivory guards around an indigo band of gold rosettes.
    ctx.lineWidth = 8;
    ctx.strokeStyle = ivory;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    ctx.strokeRect(field.x - 10, field.y - 10, field.w + 20, field.h + 20);
    ctx.lineWidth = 44;
    ctx.strokeStyle = indigo;
    ctx.strokeRect(64, 64, W - 128, H - 128);
    const rosette = (x: number, y: number) => {
      ctx.fillStyle = gold;
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = red;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let x = 64; x <= W - 64; x += 30) {
      rosette(x, 64);
      rosette(x, H - 64);
    }
    for (let y = 94; y <= H - 94; y += 30) {
      rosette(64, y);
      rosette(W - 64, y);
    }

    // Abrash, then wool.
    for (let y = 0; y < H; y += 6) {
      if (random() > 0.82) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,240,220" : "0,0,0"},${0.03 + random() * 0.05})`;
        ctx.fillRect(0, y, W, 6 + random() * 30);
      }
    }
    grain(ctx, W, H, 26, 7);
  });
}

/** Dusk over a wooded garden, wide enough that each window shows its own third. */
function makeDusk() {
  const W = 768,
    H = 1024;
  return canvasTexture(W, H, (ctx) => {
    const random = seeded(41);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#0e1830");
    sky.addColorStop(0.42, "#2a3858");
    sky.addColorStop(0.62, "#8a6a74");
    sky.addColorStop(0.72, "#d58f5e");
    sky.addColorStop(0.78, "#e9a96a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,250,235,${0.3 + random() * 0.5})`;
      ctx.fillRect(random() * W, random() * H * 0.35, 1.5, 1.5);
    }
    // Tree line: overlapping crowns, darkest at the ground.
    ctx.fillStyle = "#121611";
    for (let x = -20; x < W + 20; x += 6 + random() * 10) {
      const top = H * (0.66 + random() * 0.1);
      const r = 18 + random() * 40;
      ctx.beginPath();
      ctx.arc(x, top + r, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(0, H * 0.78, W, H);
  });
}

/** Many boxes in one draw call: panels, beams, books. */
function BoxInstances({
  boxes,
  colors,
  castShadow = false,
  children,
}: {
  boxes: [Point, Point, number?][];
  colors?: string[];
  castShadow?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const color = new THREE.Color();
    boxes.forEach(([p, s, tilt = 0], i) => {
      rotation.setFromEuler(euler.set(0, 0, tilt));
      matrix.compose(
        new THREE.Vector3(...p),
        rotation,
        new THREE.Vector3(...s),
      );
      mesh.setMatrixAt(i, matrix);
      if (colors) mesh.setColorAt(i, color.set(colors[i]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes, colors]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, boxes.length]}
      castShadow={castShadow}
      receiveShadow
    >
      <boxGeometry />
      {children}
    </instancedMesh>
  );
}

type Range = [number, number];

/**
 * A wall's raised panelling in its own plane (x along the wall, y up, the
 * room toward +z): a skirting, a dado row, a chair rail, a tall upper row, a
 * frieze rail and a crown. Panels that would sit behind a fireplace, window,
 * door or furniture are left out via `skipLower` / `skipUpper`.
 */
function panelLayout(length: number, skipLower: Range[], skipUpper: Range[]) {
  const boxes: [Point, Point][] = [];
  const columns = Math.round(length / 3.2);
  const pitch = length / columns;
  const width = pitch - 0.5;
  const rows: [number, number, Range[]][] = [
    [-2.0, 1.5, skipLower],
    [2.5, 12.9, skipUpper],
  ];
  for (const [bottom, top, skip] of rows) {
    const height = top - bottom;
    const y = (top + bottom) / 2;
    for (let i = 0; i < columns; i++) {
      const x = -length / 2 + pitch * (i + 0.5);
      if (skip.some(([a, b]) => x + width / 2 > a && x - width / 2 < b))
        continue;
      // Flat field, then the raised centre a little proud of it.
      boxes.push([
        [x, y, 0.025],
        [width, height, 0.05],
      ]);
      boxes.push([
        [x, y, 0.06],
        [width - 0.42, height - 0.42, 0.08],
      ]);
    }
  }
  const mouldings: [Point, Point][] = [
    [
      [0, -2.36, 0.06],
      [length, 0.48, 0.12],
    ], // skirting
    [
      [0, 1.95, 0.07],
      [length, 0.16, 0.14],
    ], // chair rail
    [
      [0, 13.35, 0.05],
      [length, 0.12, 0.1],
    ], // frieze rail
    [
      [0, 14.3, 0.15],
      [length, 0.42, 0.3],
    ], // crown
  ];
  return { panels: boxes, mouldings };
}

function PanelledWall({
  position,
  rotation,
  length,
  skipLower = [],
  skipUpper = [],
  wood,
}: {
  position: Point;
  rotation: number;
  length: number;
  skipLower?: Range[];
  skipUpper?: Range[];
  wood: THREE.Texture;
}) {
  // Ranges arrive as fresh literals each render; key the layout on their values.
  const key = JSON.stringify([length, skipLower, skipUpper]);
  const { panels, mouldings } = useMemo(() => {
    const [l, lower, upper] = JSON.parse(key) as [number, Range[], Range[]];
    return panelLayout(l, lower, upper);
  }, [key]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <BoxInstances boxes={panels}>
        <meshStandardMaterial color={MAHOGANY} map={wood} roughness={0.42} />
      </BoxInstances>
      <BoxInstances boxes={mouldings}>
        <meshStandardMaterial
          color={MAHOGANY_DARK}
          map={wood}
          roughness={0.4}
        />
      </BoxInstances>
    </group>
  );
}

const BOOK_COLORS = [
  "#5b1a17",
  "#2c3b2a",
  "#1f2a3d",
  "#7a5a34",
  "#3a2418",
  "#6b4a2b",
  "#8a7a5a",
  "#2a2522",
  "#4a1c26",
  "#9c8a6a",
  "#35402f",
  "#a3473a",
];

/** Every spine on every shelf of one built-in case, laid out once. */
function bookLayout(
  left: number,
  width: number,
  shelves: number[],
  seed: number,
) {
  const random = seeded(seed);
  const boxes: [Point, Point, number?][] = [];
  const colors: string[] = [];
  const bays = 3;
  const bay = width / bays;
  const back = -13.35;
  for (const shelf of shelves) {
    for (let b = 0; b < bays; b++) {
      const start = left + b * bay + 0.18;
      const end = left + (b + 1) * bay - 0.18;
      let x = start;
      // Most runs fill the bay; some end early with a short stack lying flat.
      const stop = random() > 0.65 ? end - 0.7 - random() * 0.5 : end;
      while (x < stop - 0.12) {
        const w = 0.12 + random() * 0.18;
        if (x + w > stop) break;
        const h = 1.0 + random() * 0.6;
        const d = 0.75 + random() * 0.2;
        const lean =
          x + w > stop - 0.3 && stop < end && random() > 0.4 ? -0.18 : 0;
        boxes.push([[x + w / 2, shelf + h / 2, back + d / 2], [w, h, d], lean]);
        colors.push(BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)]);
        x += w + (random() > 0.92 ? 0.05 : 0.008);
      }
      if (stop < end) {
        let y = shelf;
        for (let i = 0; i < 3; i++) {
          const h = 0.12 + random() * 0.1;
          const w = 0.75 + random() * 0.2;
          boxes.push([
            [end - 0.5, y + h / 2, back + 0.45],
            [w, h, 0.8],
          ]);
          colors.push(BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)]);
          y += h;
        }
      }
    }
  }
  return { boxes, colors };
}

const SHELVES = [0.75, 2.75, 4.75, 6.75, 8.75, 10.75];

function Bookcase({
  x,
  wood,
  seed,
}: {
  x: number;
  wood: THREE.Texture;
  seed: number;
}) {
  const width = 8.6;
  const books = useMemo(
    () => bookLayout(x - width / 2, width, SHELVES, seed),
    [x, seed],
  );
  const frame = useMemo(() => {
    const parts: [Point, Point][] = [];
    const front = -12.25;
    const depth = 1.3;
    const z = front - depth / 2;
    // Sides and the two bay dividers.
    for (let i = 0; i <= 3; i++) {
      parts.push([
        [x - width / 2 + (width / 3) * i, 5.3, z],
        [0.2, 15.8, depth],
      ]);
    }
    for (const y of SHELVES.slice(1))
      parts.push([
        [x, y - 0.06, z],
        [width, 0.12, depth],
      ]);
    parts.push([
      [x, 12.75, z + 0.05],
      [width + 0.3, 0.5, depth + 0.1],
    ]); // cornice
    parts.push([
      [x, 0.68, z + 0.06],
      [width + 0.2, 0.16, depth + 0.12],
    ]); // counter
    // Cabinet doors below the counter, each with a raised field.
    for (let i = 0; i < 3; i++) {
      const cx = x - width / 2 + (width / 3) * (i + 0.5);
      parts.push([
        [cx, -1.0, front - 0.02],
        [width / 3 - 0.3, 2.9, 0.06],
      ]);
      parts.push([
        [cx, -1.0, front + 0.02],
        [width / 3 - 0.8, 2.3, 0.06],
      ]);
    }
    parts.push([
      [x, -2.42, front - 0.05],
      [width + 0.1, 0.36, 0.12],
    ]); // plinth
    return parts;
  }, [x]);
  return (
    <group>
      {/* Dark back boards: the shelves read as deep. */}
      <Box
        position={[x, 5.3, -13.47]}
        size={[width, 15.8, 0.08]}
        color="#3a1a12"
        map={wood}
      />
      <BoxInstances boxes={frame} castShadow>
        <meshStandardMaterial color={MAHOGANY} map={wood} roughness={0.38} />
      </BoxInstances>
      <BoxInstances boxes={books.boxes} colors={books.colors}>
        <meshStandardMaterial color="#ffffff" roughness={0.72} />
      </BoxInstances>
      {[-1, 0, 1].map((i) => (
        <mesh key={i} position={[x + (width / 3) * i, -0.4, -12.18]} castShadow>
          <sphereGeometry args={[0.07, 12, 8]} />
          <meshStandardMaterial color={BRASS} metalness={1} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Fire({ reducedMotion }: { reducedMotion?: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  const flames = useRef<THREE.Group>(null);
  const glow = useMemo(
    () =>
      canvasTexture(256, 256, (ctx) => {
        const g = ctx.createRadialGradient(128, 170, 4, 128, 170, 128);
        g.addColorStop(0, "rgba(255,190,110,1)");
        g.addColorStop(0.4, "rgba(255,110,40,0.55)");
        g.addColorStop(1, "rgba(255,80,20,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 256);
      }),
    [],
  );
  useEffect(() => () => glow.dispose(), [glow]);
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    const t = clock.elapsedTime;
    const flicker =
      0.82 + 0.1 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1 + 1.7);
    if (light.current) light.current.intensity = 7 * flicker;
    flames.current?.children.forEach((flame, i) => {
      flame.scale.y = 0.85 + 0.2 * Math.sin(t * (6 + i * 1.3) + i);
    });
  });
  const flame = (x: number, z: number, r: number, h: number, color: string) => (
    <mesh key={`${x}-${z}-${color}`} position={[x, -2.1 + h / 2, z]}>
      <coneGeometry args={[r, h, 12, 1, true]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.8}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
  return (
    <group>
      {/* Logs and embers. */}
      {[
        [0, -2.35, -12.9, 0.25],
        [0, -2.35, -12.6, -0.3],
        [0.1, -2.05, -12.8, 0.05],
      ].map(([x, y, z, r], i) => (
        <mesh
          key={i}
          position={[x, y, z]}
          rotation={[0, r, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[0.17, 0.2, 2.1, 10]} />
          <meshStandardMaterial
            color="#3b2618"
            roughness={1}
            emissive="#ff4a10"
            emissiveIntensity={0.12}
          />
        </mesh>
      ))}
      <group ref={flames}>
        {flame(-0.45, -12.75, 0.28, 1.0, "#ff6a1a")}
        {flame(0.05, -12.7, 0.36, 1.45, "#ff7a22")}
        {flame(0.5, -12.8, 0.26, 0.9, "#ff6a1a")}
        {flame(-0.15, -12.65, 0.18, 0.9, "#ffc060")}
        {flame(0.3, -12.6, 0.16, 0.7, "#ffd27a")}
      </group>
      <mesh position={[0, -1.4, -13.24]}>
        <planeGeometry args={[3.2, 3]} />
        <meshBasicMaterial
          map={glow}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        ref={light}
        position={[0, -1.5, -12.2]}
        color="#ff9a4a"
        intensity={7}
        distance={16}
        decay={2}
      />
    </group>
  );
}

function Fireplace({
  wood,
  marble,
  painting,
  reducedMotion,
}: {
  wood: THREE.Texture;
  marble: THREE.Texture;
  painting: THREE.Texture;
  reducedMotion?: boolean;
}) {
  const breastFront = -12.45;
  return (
    <group>
      {/* Chimney breast, built round the firebox opening. */}
      <Box
        position={[-2.95, 5.95, -13]}
        size={[2.5, 17.1, 1.1]}
        color={MAHOGANY}
        map={wood}
        roughness={0.4}
      />
      <Box
        position={[2.95, 5.95, -13]}
        size={[2.5, 17.1, 1.1]}
        color={MAHOGANY}
        map={wood}
        roughness={0.4}
      />
      <Box
        position={[0, 7.7, -13]}
        size={[3.4, 13.6, 1.1]}
        color={MAHOGANY}
        map={wood}
        roughness={0.4}
      />
      {/* Firebox: sooty brick back and cheeks. */}
      <Box
        position={[0, -0.85, -13.4]}
        size={[3.4, 3.5, 0.2]}
        color="#2a1a14"
        roughness={1}
      />
      {[-1.6, 1.6].map((x) => (
        <Box
          key={x}
          position={[x, -0.85, -12.9]}
          size={[0.2, 3.5, 1]}
          color="#24170f"
          roughness={1}
        />
      ))}
      <Box
        position={[0, 0.85, -12.9]}
        size={[3.4, 0.12, 1]}
        color="#130c08"
        roughness={1}
      />
      {/* Marble surround, hearth and a mahogany mantel shelf. */}
      <Box
        position={[-2.45, 0, breastFront + 0.1]}
        size={[1.5, 5.2, 0.22]}
        color="#ffffff"
        map={marble}
        clearcoat={0.5}
        roughness={0.3}
      />
      <Box
        position={[2.45, 0, breastFront + 0.1]}
        size={[1.5, 5.2, 0.22]}
        color="#ffffff"
        map={marble}
        clearcoat={0.5}
        roughness={0.3}
      />
      <Box
        position={[0, 1.75, breastFront + 0.1]}
        size={[3.4, 1.7, 0.22]}
        color="#ffffff"
        map={marble}
        clearcoat={0.5}
        roughness={0.3}
      />
      <Box
        position={[0, -2.52, -11.75]}
        size={[7.6, 0.16, 1.5]}
        color="#ffffff"
        map={marble}
        clearcoat={0.5}
        roughness={0.3}
      />
      <Box
        position={[0, 2.72, -12.25]}
        size={[7.4, 0.26, 1.15]}
        color={MAHOGANY_DARK}
        map={wood}
        clearcoat={0.6}
        roughness={0.35}
      />
      <Fire reducedMotion={reducedMotion} />
      {/* Brass candlesticks and a bracket clock on the mantel. */}
      {[-2.9, 2.9].map((x) => (
        <group key={x} position={[x, 2.85, -12.2]}>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.22, 0.26, 0.1, 20]} />
            <meshStandardMaterial
              color={BRASS}
              metalness={1}
              roughness={0.28}
            />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.06, 0.09, 0.9, 12]} />
            <meshStandardMaterial
              color={BRASS}
              metalness={1}
              roughness={0.28}
            />
          </mesh>
          <mesh position={[0, 1.2, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.55, 12]} />
            <meshStandardMaterial color="#f1e9d6" roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.55, 0]}>
            <sphereGeometry args={[0.055, 10, 8]} />
            <meshBasicMaterial color="#ffd9a0" toneMapped={false} />
          </mesh>
        </group>
      ))}
      <group position={[0, 2.85, -12.3]}>
        <RoundedBox
          args={[1.2, 1.5, 0.6]}
          radius={0.08}
          position={[0, 0.75, 0]}
          castShadow
        >
          <meshPhysicalMaterial
            color={MAHOGANY_DARK}
            map={wood}
            roughness={0.35}
            clearcoat={0.7}
          />
        </RoundedBox>
        <mesh position={[0, 0.85, 0.31]}>
          <circleGeometry args={[0.38, 32]} />
          <meshStandardMaterial color="#efe6cf" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.85, 0.305]}>
          <ringGeometry args={[0.38, 0.45, 32]} />
          <meshStandardMaterial color={BRASS} metalness={1} roughness={0.25} />
        </mesh>
      </group>
      {/* Gilt-framed oil above the mantel. */}
      <Box
        position={[0, 7.3, breastFront + 0.08]}
        size={[5.6, 4, 0.16]}
        color="#a07a3a"
        metal={0.85}
        roughness={0.35}
      />
      <mesh position={[0, 7.3, breastFront + 0.17]}>
        <planeGeometry args={[5, 3.4]} />
        <meshStandardMaterial map={painting} roughness={0.55} />
      </mesh>
    </group>
  );
}

/** Instanced brass buttons for deep-buttoned leather. */
function Buttons({ points }: { points: Point[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    points.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(...p)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [points]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, points.length]}>
      <sphereGeometry args={[0.045, 8, 6]} />
      <meshStandardMaterial color="#3a120d" roughness={0.45} />
    </instancedMesh>
  );
}

function diamondGrid(
  xs: [number, number],
  ys: number[],
  z: number,
  step = 0.55,
): Point[] {
  const points: Point[] = [];
  ys.forEach((y, row) => {
    for (let x = xs[0] + (row % 2 ? step / 2 : 0); x <= xs[1] + 1e-6; x += step)
      points.push([x, y, z]);
  });
  return points;
}

function Leather({
  map,
  color = LEATHER,
}: {
  map: THREE.Texture;
  color?: string;
}) {
  return (
    <meshPhysicalMaterial
      color={color}
      map={map}
      roughness={0.52}
      clearcoat={0.35}
      clearcoatRoughness={0.38}
    />
  );
}

/** A deep-buttoned Chesterfield: back and rolled arms at one height. */
function Chesterfield({
  leather,
  tufted,
}: {
  leather: THREE.Texture;
  tufted: THREE.Texture;
}) {
  const buttons = useMemo(
    () => diamondGrid([-3.85, 3.85], [1.45, 1.85, 2.25], -0.7),
    [],
  );
  return (
    <group position={[0, FLOOR_Y, -6.3]}>
      <RoundedBox
        args={[9.2, 0.75, 2.6]}
        radius={0.12}
        position={[0, 0.6, 0]}
        castShadow
        receiveShadow
      >
        <Leather map={leather} />
      </RoundedBox>
      <RoundedBox
        args={[8.6, 1.95, 0.62]}
        radius={0.12}
        position={[0, 1.85, -1.03]}
        castShadow
        receiveShadow
      >
        <Leather map={tufted} />
      </RoundedBox>
      <mesh position={[0, 2.8, -1.0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.33, 0.33, 8.6, 24]} />
        <Leather map={leather} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <RoundedBox
            args={[0.62, 1.9, 2.7]}
            radius={0.12}
            position={[side * 4.4, 1.85, 0]}
            castShadow
            receiveShadow
          >
            <Leather map={tufted} />
          </RoundedBox>
          <mesh
            position={[side * 4.48, 2.78, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.38, 0.38, 2.7, 24]} />
            <Leather map={leather} />
          </mesh>
        </group>
      ))}
      {[-2.75, 0, 2.75].map((x) => (
        <RoundedBox
          key={x}
          args={[2.72, 0.45, 2.0]}
          radius={0.15}
          smoothness={4}
          position={[x, 1.2, 0.25]}
          castShadow
          receiveShadow
        >
          <Leather map={leather} />
        </RoundedBox>
      ))}
      <Buttons points={buttons} />
      {[-4.4, 0, 4.4].flatMap((x) =>
        [-1.1, 1.1].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.11, z]}>
            <sphereGeometry args={[0.15, 12, 10]} />
            <meshStandardMaterial color="#2a120b" roughness={0.4} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** A low club chair in the sofa's leather, facing the table (-z). */
function ClubChair({
  position,
  rotation,
  leather,
  tufted,
}: {
  position: Point;
  rotation: number;
  leather: THREE.Texture;
  tufted: THREE.Texture;
}) {
  const buttons = useMemo(
    () => diamondGrid([-0.66, 0.66], [1.45, 1.85, 2.2], 0.72, 0.44),
    [],
  );
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <RoundedBox
        args={[2.6, 0.75, 2.25]}
        radius={0.12}
        position={[0, 0.6, 0]}
        castShadow
        receiveShadow
      >
        <Leather map={leather} />
      </RoundedBox>
      <RoundedBox
        args={[1.75, 0.42, 1.75]}
        radius={0.14}
        smoothness={4}
        position={[0, 1.17, -0.18]}
        castShadow
        receiveShadow
      >
        <Leather map={leather} />
      </RoundedBox>
      <RoundedBox
        args={[2.6, 1.9, 0.48]}
        radius={0.12}
        position={[0, 1.7, 0.95]}
        castShadow
        receiveShadow
      >
        <Leather map={tufted} />
      </RoundedBox>
      <mesh
        position={[0, 2.62, 0.95]}
        rotation={[0, 0, Math.PI / 2]}
        castShadow
      >
        <cylinderGeometry args={[0.26, 0.26, 2.6, 20]} />
        <Leather map={leather} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <RoundedBox
            args={[0.44, 1.5, 2.25]}
            radius={0.1}
            position={[side * 1.08, 1.3, 0]}
            castShadow
            receiveShadow
          >
            <Leather map={leather} />
          </RoundedBox>
          <mesh
            position={[side * 1.12, 2.02, -0.05]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.27, 0.27, 2.2, 20]} />
            <Leather map={leather} />
          </mesh>
        </group>
      ))}
      <Buttons points={buttons} />
      {[-1.1, 1.1].flatMap((x) =>
        [-0.95, 0.95].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 0.11, z]}>
            <cylinderGeometry args={[0.1, 0.13, 0.22, 12]} />
            <meshStandardMaterial color="#2a120b" roughness={0.4} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** A turned-leg mahogany table: its top is exactly where the Apartment's is. */
function CoffeeTable({
  wood,
  top,
}: {
  wood: THREE.Texture;
  top: THREE.Texture;
}) {
  return (
    <group>
      <Box
        position={[0, -0.19, 0]}
        size={[8.5, 0.36, 7.65]}
        color="#9a4a3a"
        map={top}
        clearcoat={0.8}
        roughness={0.32}
      />
      <Box
        position={[0, -0.6, 0]}
        size={[7.9, 0.46, 7.05]}
        color={MAHOGANY_DARK}
        map={wood}
        roughness={0.4}
      />
      {[-3.55, 3.55].flatMap((x) =>
        [-3.1, 3.1].map((z) => (
          <group key={`${x}-${z}`} position={[x, 0, z]}>
            <mesh position={[0, -1.6, 0]} castShadow>
              <cylinderGeometry args={[0.2, 0.15, 1.9, 16]} />
              <meshPhysicalMaterial
                color={MAHOGANY}
                map={wood}
                roughness={0.38}
                clearcoat={0.6}
              />
            </mesh>
            {[
              [-1.05, 0.3],
              [-2.2, 0.22],
            ].map(([y, r]) => (
              <mesh key={y} position={[0, y, 0]} castShadow>
                <sphereGeometry args={[r, 16, 12]} />
                <meshPhysicalMaterial
                  color={MAHOGANY}
                  map={wood}
                  roughness={0.38}
                  clearcoat={0.6}
                />
              </mesh>
            ))}
            <mesh position={[0, -2.5, 0]}>
              <cylinderGeometry args={[0.13, 0.13, 0.2, 12]} />
              <meshStandardMaterial
                color={BRASS}
                metalness={1}
                roughness={0.3}
              />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/** A pedestal side table with a brass lamp, lit. */
function LampTable({
  position,
  wood,
  light,
}: {
  position: Point;
  wood: THREE.Texture;
  light: boolean;
}) {
  return (
    <group position={position}>
      <mesh position={[0, 1.98, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.9, 0.9, 0.12, 40]} />
        <meshPhysicalMaterial
          color={MAHOGANY}
          map={wood}
          roughness={0.35}
          clearcoat={0.7}
        />
      </mesh>
      <mesh position={[0, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.2, 1.9, 16]} />
        <meshStandardMaterial
          color={MAHOGANY_DARK}
          map={wood}
          roughness={0.4}
        />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[
            Math.cos((i * Math.PI * 2) / 3) * 0.35,
            0.1,
            Math.sin((i * Math.PI * 2) / 3) * 0.35,
          ]}
          rotation={[0, -(i * Math.PI * 2) / 3, 0]}
          castShadow
        >
          <boxGeometry args={[0.8, 0.14, 0.14]} />
          <meshStandardMaterial
            color={MAHOGANY_DARK}
            map={wood}
            roughness={0.4}
          />
        </mesh>
      ))}
      <mesh position={[0, 2.1, 0]}>
        <cylinderGeometry args={[0.28, 0.32, 0.12, 24]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.28} />
      </mesh>
      <mesh position={[0, 2.85, 0]}>
        <cylinderGeometry args={[0.05, 0.07, 1.5, 12]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.28} />
      </mesh>
      <mesh position={[0, 3.9, 0]}>
        <cylinderGeometry args={[0.45, 0.7, 0.85, 32, 1, true]} />
        <meshStandardMaterial
          color="#e8d6b0"
          emissive="#ffcf8a"
          emissiveIntensity={0.7}
          roughness={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 3.7, 0]}>
        <sphereGeometry args={[0.15, 14, 10]} />
        <meshBasicMaterial color="#fff2da" toneMapped={false} />
      </mesh>
      {light && (
        <pointLight
          position={[0, 3.7, 0]}
          color="#ffcf96"
          intensity={4}
          distance={11}
          decay={2}
        />
      )}
    </group>
  );
}

function Window({
  z,
  third,
  dusk,
  wood,
  drapes,
}: {
  z: number;
  third: number;
  dusk: THREE.Texture;
  wood: THREE.Texture;
  drapes: THREE.Texture;
}) {
  const view = useMemo(() => {
    const t = dusk.clone();
    t.repeat.set(1 / 3, 1);
    t.offset.set(third / 3, 0);
    return t;
  }, [dusk, third]);
  useEffect(() => () => view.dispose(), [view]);
  const x = -13.35;
  return (
    <group>
      <mesh position={[x + 0.04, 4.9, z]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[3.4, 11]} />
        <meshBasicMaterial map={view} toneMapped={false} />
      </mesh>
      {/* Architrave, sill, and glazing bars. */}
      {[-1.85, 1.85].map((dz) => (
        <Box
          key={dz}
          position={[x + 0.12, 4.85, z + dz]}
          size={[0.24, 11.4, 0.36]}
          color={MAHOGANY_DARK}
          map={wood}
          roughness={0.4}
        />
      ))}
      <Box
        position={[x + 0.12, 10.6, z]}
        size={[0.24, 0.4, 4.1]}
        color={MAHOGANY_DARK}
        map={wood}
        roughness={0.4}
      />
      <Box
        position={[x + 0.3, -0.75, z]}
        size={[0.6, 0.22, 4.2]}
        color={MAHOGANY}
        map={wood}
        clearcoat={0.5}
        roughness={0.35}
      />
      <Box
        position={[x + 0.08, 4.9, z]}
        size={[0.1, 11, 0.09]}
        color="#2b1810"
      />
      {[1.25, 4.9, 8.55].map((y) => (
        <Box
          key={y}
          position={[x + 0.08, y, z]}
          size={[0.1, y === 4.9 ? 0.16 : 0.08, 3.4]}
          color="#2b1810"
        />
      ))}
      {/* Brass pole and heavy burgundy velvet drapes. */}
      <mesh position={[x + 0.55, 11.4, z]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 6.4, 12]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.3} />
      </mesh>
      {[-3.2, 3.2].map((dz) => (
        <mesh key={dz} position={[x + 0.55, 11.4, z + dz]}>
          <sphereGeometry args={[0.13, 14, 10]} />
          <meshStandardMaterial color={BRASS} metalness={1} roughness={0.3} />
        </mesh>
      ))}
      {[-2.45, 2.45].map((dz) =>
        Array.from({ length: 7 }, (_, i) => (
          <mesh
            key={`${dz}-${i}`}
            position={[x + 0.5 + (i % 2) * 0.08, 4.4, z + dz + (i - 3) * 0.13]}
            castShadow
          >
            <cylinderGeometry args={[0.11, 0.15, 13.9, 8]} />
            <meshPhysicalMaterial
              color="#7a1f26"
              map={drapes}
              roughness={1}
              sheen={1}
              sheenRoughness={0.4}
              sheenColor="#d46a72"
            />
          </mesh>
        )),
      )}
    </group>
  );
}

function Sconce({ position, rotation }: { position: Point; rotation: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0, 0.04]}>
        <cylinderGeometry args={[0.18, 0.18, 0.08, 20]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.2, 0.3]} rotation={[0.9, 0, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.6, 8]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.65, 0.5]}>
        <cylinderGeometry args={[0.22, 0.32, 0.4, 24, 1, true]} />
        <meshStandardMaterial
          color="#e8d6b0"
          emissive="#ffcf8a"
          emissiveIntensity={0.8}
          roughness={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function Chandelier() {
  const arms = 8;
  return (
    <group position={[0, 0, 0]}>
      <mesh position={[0, 13.85, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 1.3, 8]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.3} />
      </mesh>
      <mesh position={[0, 13.1, 0]}>
        <sphereGeometry args={[0.28, 20, 16]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.25} />
      </mesh>
      <mesh position={[0, 12.85, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.4, 0.05, 10, 64]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.25} />
      </mesh>
      <mesh position={[0, 12.7, 0]}>
        <sphereGeometry args={[0.16, 14, 10]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.25} />
      </mesh>
      {Array.from({ length: arms }, (_, i) => {
        const a = (i / arms) * Math.PI * 2;
        const x = Math.cos(a) * 1.4,
          z = Math.sin(a) * 1.4;
        return (
          <group key={i}>
            <mesh
              position={[x / 2, 12.98, z / 2]}
              rotation={[0, -a, Math.PI / 2 - 0.15]}
            >
              <cylinderGeometry args={[0.025, 0.025, 1.4, 6]} />
              <meshStandardMaterial
                color={BRASS}
                metalness={1}
                roughness={0.3}
              />
            </mesh>
            <mesh position={[x, 12.94, z]}>
              <cylinderGeometry args={[0.11, 0.08, 0.12, 12]} />
              <meshStandardMaterial
                color={BRASS}
                metalness={1}
                roughness={0.3}
              />
            </mesh>
            <mesh position={[x, 13.2, z]}>
              <cylinderGeometry args={[0.055, 0.055, 0.42, 10]} />
              <meshStandardMaterial color="#f3ecdb" roughness={0.6} />
            </mesh>
            <mesh position={[x, 13.48, z]}>
              <sphereGeometry args={[0.07, 10, 8]} />
              <meshBasicMaterial color="#ffe0a8" toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Mahogany sideboard under a gilt mirror, on the solid wall facing the windows. */
function Sideboard({ wood }: { wood: THREE.Texture }) {
  const front = 12.25;
  return (
    <group>
      <Box
        position={[12.78, -0.85, 0]}
        size={[1.05, 2.7, 6]}
        color={MAHOGANY}
        map={wood}
        roughness={0.4}
      />
      <Box
        position={[12.75, 0.58, 0]}
        size={[1.2, 0.16, 6.2]}
        color={MAHOGANY_DARK}
        map={wood}
        clearcoat={0.7}
        roughness={0.32}
      />
      {[-1.95, 0, 1.95].map((z) => (
        <group key={z}>
          <Box
            position={[front - 0.02, -0.95, z]}
            size={[0.06, 2.2, 1.75]}
            color={MAHOGANY_DARK}
            map={wood}
            roughness={0.4}
          />
          <Box
            position={[front - 0.06, -0.95, z]}
            size={[0.06, 1.7, 1.25]}
            color={MAHOGANY}
            map={wood}
            roughness={0.4}
          />
          <mesh position={[front - 0.14, 0.1, z]}>
            <sphereGeometry args={[0.06, 10, 8]} />
            <meshStandardMaterial color={BRASS} metalness={1} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {[-2.7, 2.7].flatMap((z) =>
        [12.4, 13.15].map((x) => (
          <Box
            key={`${x}-${z}`}
            position={[x, -2.4, z]}
            size={[0.16, 0.4, 0.16]}
            color={MAHOGANY_DARK}
            map={wood}
          />
        )),
      )}
      {/* Gilt mirror. There's no live reflection, so it's antique glass:
          dark, warm and glossy, catching the room's lamps as highlights
          instead of reading as a black hole in the wall. */}
      <Box
        position={[13.27, 5, 0]}
        size={[0.12, 6.8, 5]}
        color="#a07a3a"
        metal={0.85}
        roughness={0.35}
      />
      <mesh position={[13.19, 5, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[4.3, 6.1]} />
        <meshPhysicalMaterial
          color="#5a4a3c"
          metalness={0.7}
          roughness={0.16}
          envMapIntensity={2.2}
          emissive="#2b1d14"
          clearcoat={1}
          clearcoatRoughness={0.04}
        />
      </mesh>
      {/* A pair of brass candlesticks. */}
      {[-2.3, 2.3].map((z) => (
        <group key={z} position={[12.75, 0.66, z]}>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.2, 0.24, 0.12, 20]} />
            <meshStandardMaterial
              color={BRASS}
              metalness={1}
              roughness={0.28}
            />
          </mesh>
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.05, 0.08, 1, 12]} />
            <meshStandardMaterial
              color={BRASS}
              metalness={1}
              roughness={0.28}
            />
          </mesh>
          <mesh position={[0, 1.35, 0]}>
            <cylinderGeometry args={[0.065, 0.065, 0.5, 12]} />
            <meshStandardMaterial color="#f1e9d6" roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.66, 0]}>
            <sphereGeometry args={[0.05, 10, 8]} />
            <meshBasicMaterial color="#ffd9a0" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Panelled double doors with brass handles, centred on the wall behind the south seat. */
function Doors({ wood }: { wood: THREE.Texture }) {
  const z = 13.45;
  return (
    <group>
      {[-1.07, 1.07].map((x) => (
        <group key={x}>
          <Box
            position={[x, 2.9, z]}
            size={[2.1, 11, 0.12]}
            color={MAHOGANY}
            map={wood}
            roughness={0.38}
          />
          {[
            [6.0, 4.4],
            [0.6, 5.0],
          ].map(([y, h]) => (
            <Box
              key={y}
              position={[x, y - 0.3, z - 0.08]}
              size={[1.5, h, 0.06]}
              color={MAHOGANY_DARK}
              map={wood}
              roughness={0.38}
            />
          ))}
          <mesh
            position={[x + (x < 0 ? 0.8 : -0.8), 2.4, z - 0.16]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.05, 0.05, 0.42, 10]} />
            <meshStandardMaterial
              color={BRASS}
              metalness={1}
              roughness={0.25}
            />
          </mesh>
        </group>
      ))}
      {/* Architrave and an entablature over the doors. */}
      {[-2.35, 2.35].map((x) => (
        <Box
          key={x}
          position={[x, 2.9, z - 0.03]}
          size={[0.45, 11.1, 0.2]}
          color={MAHOGANY_DARK}
          map={wood}
          roughness={0.38}
        />
      ))}
      <Box
        position={[0, 8.75, z - 0.05]}
        size={[5.4, 0.6, 0.25]}
        color={MAHOGANY_DARK}
        map={wood}
        roughness={0.38}
      />
      <Box
        position={[0, 9.15, z - 0.12]}
        size={[5.9, 0.22, 0.4]}
        color={MAHOGANY}
        map={wood}
        roughness={0.38}
      />
    </group>
  );
}

const MAHOGANY_FLOOR_SHADES: [
  number,
  number,
  number,
  number,
  number,
  number,
][] = [
  [0, RUG_Y, -6.3, 9.4, 2.7, 0.8], // sofa
  [0, RUG_Y, 6.2, 2.6, 2.3, 0.75], // club chairs
  [-6.2, RUG_Y, 0, 2.3, 2.6, 0.75],
  [6.2, RUG_Y, 0, 2.3, 2.6, 0.75],
  [0, RUG_Y, 0, 8, 7.2, 0.35], // under the coffee table
  [-5.9, FLOOR_Y, -6.4, 1.5, 1.5, 0.6], // lamp tables
  [5.9, FLOOR_Y, -6.4, 1.5, 1.5, 0.6],
  [12.8, FLOOR_Y, 0, 1.1, 6, 0.6], // sideboard
  [-8.6, FLOOR_Y, -12.9, 8.6, 1.3, 0.55], // bookcases
  [8.6, FLOOR_Y, -12.9, 8.6, 1.3, 0.55],
];

export function MahoganyRoom({
  quality,
  reducedMotion,
}: {
  quality: Quality;
  reducedMotion?: boolean;
}) {
  const anisotropy = quality === "low" ? 2 : 8;
  const [woodSource, floorSource, topSource, drapeSource, paintingSource] =
    useTexture([
      "/textures/board-wood.webp",
      "/textures/floor.jpg",
      "/textures/table-top.webp",
      "/textures/curtains.jpg",
      "/textures/painting-2.webp",
    ]);
  const textures = useMemo(() => {
    const prepare = (source: THREE.Texture, repeat?: [number, number]) => {
      const t = source.clone();
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = anisotropy;
      if (repeat) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(...repeat);
      }
      return t;
    };
    // RoundedBox UVs run in world units, not 0-1 per face: one tile is one
    // diamond, sized to the button grid (0.55 across, two 0.4 rows high).
    const tufted = makeTufted();
    tufted.repeat.set(1 / 0.55, 1 / 0.8);
    const leather = makeLeather();
    leather.repeat.set(0.5, 0.5);
    return {
      wood: prepare(woodSource),
      floor: prepare(floorSource, [4, 4]),
      top: prepare(topSource),
      drapes: prepare(drapeSource),
      painting: prepare(paintingSource),
      leather,
      tufted,
      marble: makeMarble(),
      rug: makeRug(),
      dusk: makeDusk(),
      ...makeOcclusionTextures(),
    };
  }, [
    woodSource,
    floorSource,
    topSource,
    drapeSource,
    paintingSource,
    anisotropy,
  ]);
  useEffect(
    () => () => Object.values(textures).forEach((t) => t.dispose()),
    [textures],
  );
  const beams = useMemo(() => {
    const parts: [Point, Point][] = [];
    for (const v of [-9, -4.5, 0, 4.5, 9]) {
      parts.push([
        [0, CEILING_Y - 0.3, v],
        [27, 0.6, 0.45],
      ]);
      parts.push([
        [v, CEILING_Y - 0.3, 0],
        [0.45, 0.6, 28],
      ]);
    }
    return parts;
  }, []);
  const {
    wood,
    floor,
    top,
    drapes,
    painting,
    leather,
    tufted,
    marble,
    rug,
    dusk,
    blob,
    edge,
  } = textures;
  // Only one lamp lights the room on the lowest quality: each light costs
  // every lit surface a little more.
  const lampLights = quality !== "low";
  return (
    <group>
      {/* Wide polished boards, then the Persian rug under the table. */}
      <Box
        position={[0, -2.73, 0]}
        size={[27, 0.25, 28]}
        color="#8a4a32"
        map={floor}
        roughness={0.34}
        clearcoat={0.4}
      />
      <Box
        position={[0, -2.57, 0]}
        size={[13, 0.065, 11.5]}
        color="#ffffff"
        map={rug}
        roughness={1}
      />

      {/* Shell: plain mahogany behind the panelling, a cream plaster ceiling
          with a coffered mahogany grid. */}
      <Box
        position={[0, 6, -13.7]}
        size={[27, 17.2, 0.3]}
        color={MAHOGANY_DARK}
        map={wood}
      />
      <Box
        position={[13.5, 6, 0]}
        size={[0.3, 17.2, 28]}
        color={MAHOGANY_DARK}
        map={wood}
      />
      <Box
        position={[0, 6, 13.7]}
        size={[27, 17.2, 0.3]}
        color={MAHOGANY_DARK}
        map={wood}
      />
      <Box
        position={[-13.5, 6, 0]}
        size={[0.3, 17.2, 28]}
        color={MAHOGANY_DARK}
        map={wood}
      />
      <Box
        position={[0, 14.65, 0]}
        size={[27, 0.25, 28]}
        color="#e3d6bd"
        roughness={0.9}
      />
      <BoxInstances boxes={beams}>
        <meshStandardMaterial color={MAHOGANY} map={wood} roughness={0.45} />
      </BoxInstances>

      {/* Panelling, leaving room for what stands against each wall. */}
      <PanelledWall
        position={[0, 0, -13.55]}
        rotation={0}
        length={27}
        skipLower={[[-13.5, 13.5]]}
        skipUpper={[[-13.5, 13.5]]}
        wood={wood}
      />
      <PanelledWall
        position={[13.35, 0, 0]}
        rotation={-Math.PI / 2}
        length={28}
        skipLower={[[-3.3, 3.3]]}
        skipUpper={[[-2.8, 2.8]]}
        wood={wood}
      />
      <PanelledWall
        position={[0, 0, 13.55]}
        rotation={Math.PI}
        length={27}
        skipLower={[[-2.7, 2.7]]}
        skipUpper={[[-3, 3]]}
        wood={wood}
      />
      <PanelledWall
        position={[-13.35, 0, 0]}
        rotation={Math.PI / 2}
        length={28}
        skipLower={[
          [-10.3, -3.7],
          [-3.3, 3.3],
          [3.7, 10.3],
        ]}
        skipUpper={[
          [-10.3, -3.7],
          [-3.3, 3.3],
          [3.7, 10.3],
        ]}
        wood={wood}
      />

      <Fireplace
        wood={wood}
        marble={marble}
        painting={painting}
        reducedMotion={reducedMotion}
      />
      <Bookcase x={-8.6} wood={wood} seed={3} />
      <Bookcase x={8.6} wood={wood} seed={17} />
      {[-7, 0, 7].map((z, i) => (
        <Window
          key={z}
          z={z}
          third={i}
          dusk={dusk}
          wood={wood}
          drapes={drapes}
        />
      ))}
      <Sideboard wood={wood} />
      <Doors wood={wood} />
      <Sconce position={[-4, 6, 13.55]} rotation={Math.PI} />
      <Sconce position={[4, 6, 13.55]} rotation={Math.PI} />
      <Sconce position={[13.35, 6, -4]} rotation={-Math.PI / 2} />
      <Sconce position={[13.35, 6, 4]} rotation={-Math.PI / 2} />
      <Chandelier />

      <Chesterfield leather={leather} tufted={tufted} />
      <ClubChair
        position={[0, FLOOR_Y, 6.2]}
        rotation={0}
        leather={leather}
        tufted={tufted}
      />
      <ClubChair
        position={[-6.2, FLOOR_Y, 0]}
        rotation={-Math.PI / 2}
        leather={leather}
        tufted={tufted}
      />
      <ClubChair
        position={[6.2, FLOOR_Y, 0]}
        rotation={Math.PI / 2}
        leather={leather}
        tufted={tufted}
      />
      <CoffeeTable wood={wood} top={top} />
      <LampTable
        position={[-5.9, FLOOR_Y, -6.4]}
        wood={wood}
        light={lampLights}
      />
      <LampTable position={[5.9, FLOOR_Y, -6.4]} wood={wood} light />

      {/* Shade where the walls meet the floor and ceiling, and under furniture. */}
      <Occlusion
        map={edge}
        position={[0, -2.6, -12.9]}
        size={[27, 1.2]}
        opacity={0.5}
      />
      <Occlusion
        map={edge}
        position={[12.7, -2.6, 0]}
        size={[28, 1.2]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        opacity={0.5}
      />
      <Occlusion
        map={edge}
        position={[0, -2.6, 12.9]}
        size={[27, 1.2]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
        opacity={0.5}
      />
      <Occlusion
        map={edge}
        position={[-12.7, -2.6, 0]}
        size={[28, 1.2]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        opacity={0.5}
      />
      {MAHOGANY_FLOOR_SHADES.map(([x, y, z, w, d, opacity], i) => (
        <Occlusion
          key={i}
          map={blob}
          position={[x, y, z]}
          size={[w / 0.7, d / 0.7]}
          opacity={opacity}
        />
      ))}
    </group>
  );
}
