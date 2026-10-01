"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Point, Quality } from "@/lib/presentation/board";
import {
  Box,
  canvasTexture,
  grain,
  makeOcclusionTextures,
  Occlusion,
  seeded,
} from "./roomParts";

/*
 * A roof terrace at dusk: teak decking inside a glass-topped parapet, the
 * city all round, string lights overhead, and the stair bulkhead you came
 * up by. The same seat positions and table height as the Apartment, so
 * cameras, seat figures and the board land as they do there. Outdoors, so
 * there's no ceiling: the sky is a dome, the skyline a ring around it.
 */

const FLOOR_Y = -2.6;
const RUG_Y = -2.53;
const EDGE = 13.5;

const TEAK = "#a8744a";
const STEEL = "#1c1e20";
const CONCRETE = "#8d8b86";
const CUSHION = "#d9d4c8";

// The stair bulkhead in the back-right corner, and the bracket on it that
// carries one end of the string lights.
const BULKHEAD = {
  x: [7.0, 13.4] as const,
  z: [-13.4, -8.0] as const,
  top: 6.0,
};

/** Sky from zenith to below the horizon: night blue into a dusk glow, then the dark city. */
function makeSky() {
  return canvasTexture(8, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, "#070d24");
    g.addColorStop(0.25, "#16204a");
    g.addColorStop(0.4, "#3a3a6e");
    g.addColorStop(0.46, "#8a5a7e");
    g.addColorStop(0.495, "#e9875f");
    g.addColorStop(0.505, "#f2a865");
    g.addColorStop(0.53, "#2a2436");
    g.addColorStop(1, "#0c0e16");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 512);
  });
}

/**
 * The skyline: two layers of towers (the far ones hazier), lit windows,
 * red aviation lights on the tallest, water tanks on a few roofs, and the
 * streets' lights below. Transparent above the buildings so the sky shows.
 * It wraps, so the ring has no seam.
 */
function makeSkyline() {
  const W = 4096,
    H = 1024;
  const horizon = H * 0.6;
  return canvasTexture(W, H, (ctx) => {
    const random = seeded(131);
    const wrap = (draw: (x: number) => void, x: number) => {
      draw(x);
      if (x < 200) draw(x + W);
      if (x > W - 400) draw(x - W);
    };
    const layer = (far: boolean) => {
      for (let x = 0; x < W;) {
        const w = (far ? 30 : 40) + random() * (far ? 90 : 130);
        const tall = random() < (far ? 0.18 : 0.1);
        const rise = tall
          ? 180 + random() * 300
          : 10 + random() * (far ? 120 : 90);
        const top = horizon - rise + (far ? 0 : 60);
        const shade = far ? 42 + random() * 10 : 20 + random() * 12;
        const water = !far && !tall && random() < 0.12;
        const lit = 0.18 + random() * 0.3;
        wrap((bx) => {
          ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 18})`;
          ctx.fillRect(bx, top, w, H - top);
          // Windows, some lit warm, some cool.
          for (let y = top + 8; y < H - 4; y += far ? 9 : 12) {
            for (let wx = bx + 5; wx < bx + w - 5; wx += far ? 7 : 9) {
              if (random() < lit) {
                ctx.fillStyle =
                  random() < 0.75
                    ? `rgba(255,${200 + Math.round(random() * 40)},140,${far ? 0.45 : 0.85})`
                    : `rgba(200,225,255,${far ? 0.35 : 0.7})`;
                ctx.fillRect(wx, y, far ? 3 : 4, far ? 4 : 6);
              }
            }
          }
          if (tall) {
            ctx.fillStyle = "#ff3b2f";
            ctx.beginPath();
            ctx.arc(bx + w / 2, top - 4, far ? 2.5 : 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
          if (water) {
            ctx.fillStyle = `rgb(${shade - 6},${shade - 3},${shade + 6})`;
            ctx.fillRect(bx + w * 0.3, top - 34, 30, 26);
            ctx.beginPath();
            ctx.moveTo(bx + w * 0.3 - 2, top - 34);
            ctx.lineTo(bx + w * 0.3 + 15, top - 46);
            ctx.lineTo(bx + w * 0.3 + 32, top - 34);
            ctx.fill();
            ctx.fillRect(bx + w * 0.3 + 3, top - 8, 3, 8);
            ctx.fillRect(bx + w * 0.3 + 24, top - 8, 3, 8);
          }
        }, x);
        x += w + (far ? 0 : random() * 6);
      }
    };
    layer(true);
    // A haze over the far layer.
    const haze = ctx.createLinearGradient(0, horizon - 300, 0, horizon + 120);
    haze.addColorStop(0, "rgba(120,90,130,0)");
    haze.addColorStop(1, "rgba(150,100,120,0.35)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - 300, W, 420);
    layer(false);
    // Streets far below: a dusting of lights.
    for (let i = 0; i < 2600; i++) {
      const y = horizon + 140 + Math.pow(random(), 0.7) * (H - horizon - 140);
      ctx.fillStyle = `rgba(255,${190 + Math.round(random() * 50)},130,${0.25 + random() * 0.5})`;
      ctx.fillRect(random() * W, y, 2, 2);
    }
  });
}

/** Stars across the upper sky, on their own transparent layer. */
function makeStars() {
  return canvasTexture(1024, 512, (ctx) => {
    const random = seeded(137);
    for (let i = 0; i < 260; i++) {
      const y = Math.pow(random(), 1.8) * 200;
      ctx.fillStyle = `rgba(255,252,240,${0.3 + random() * 0.6})`;
      ctx.beginPath();
      ctx.arc(random() * 1024, y, random() < 0.1 ? 1.4 : 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Outdoor rug: navy diamond lattice on cream, with a navy border. */
function makeRug() {
  return canvasTexture(1040, 920, (ctx) => {
    ctx.fillStyle = "#e8e2d4";
    ctx.fillRect(0, 0, 1040, 920);
    ctx.strokeStyle = "#1f2b4a";
    ctx.lineWidth = 10;
    for (let i = -920; i < 1040 + 920; i += 80) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 920, 920);
      ctx.moveTo(i + 920, 0);
      ctx.lineTo(i, 920);
      ctx.stroke();
    }
    ctx.lineWidth = 46;
    ctx.strokeRect(23, 23, 1040 - 46, 920 - 46);
    // Flat-woven polypropylene texture.
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.lineWidth = 1;
    for (let y = 0; y < 920; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1040, y);
      ctx.stroke();
    }
    grain(ctx, 1040, 920, 16, 139);
  });
}

/** Weathering steel: rust oranges and browns, mottled. */
function makeCorten() {
  const t = canvasTexture(256, 256, (ctx) => {
    const random = seeded(149);
    ctx.fillStyle = "#8a4a26";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 70; i++) {
      const x = random() * 256,
        y = random() * 256,
        r = 10 + random() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(
        0,
        random() > 0.5 ? "rgba(170,90,40,0.5)" : "rgba(60,30,18,0.4)",
      );
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    grain(ctx, 256, 256, 26, 151);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Board-formed concrete: grey with faint shuttering lines. */
function makeConcrete() {
  const t = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#9a9893";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 256, 2);
    grain(ctx, 256, 256, 24, 157);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Woven rope for the lounge chairs: a lattice, transparent between. */
function makeRope() {
  const t = canvasTexture(128, 128, (ctx) => {
    ctx.strokeStyle = "#cfc4ae";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    for (let i = -128; i < 256; i += 22) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.moveTo(i + 128, 0);
      ctx.lineTo(i, 128);
      ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

/** Navy-and-cream striped outdoor cushion cloth. */
function makeStripe() {
  const t = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#e8e2d4";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#1f2b4a";
    for (let x = 0; x < 128; x += 32) ctx.fillRect(x, 0, 14, 128);
    grain(ctx, 128, 128, 14, 163);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Points along a hanging cable from a to b that sags `sag` at its middle. */
function catenary(a: Point, b: Point, sag: number, steps: number) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return new THREE.Vector3(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
      a[2] + (b[2] - a[2]) * t,
    );
  });
}

// Pole tops and the bulkhead bracket the strings run between. High enough
// that even sagging, no cable comes down to where a camera can be.
const POLES: Point[] = [
  [-12.6, 13.8, -12.6],
  [-12.6, 13.8, 12.6],
  [12.6, 13.8, 12.6],
];
const BRACKET: Point = [
  BULKHEAD.x[0] + 0.2,
  BULKHEAD.top + 7.8,
  BULKHEAD.z[1] + 0.2,
];
// Round the edge only, so no cable ever crosses over the board.
const STRANDS: [Point, Point][] = [
  [POLES[0], POLES[1]],
  [POLES[1], POLES[2]],
  [POLES[2], BRACKET],
  [BRACKET, POLES[0]],
];

/** Festoon lights: black cables, warm bulbs every so often, two of them lighting the deck. */
function StringLights({ lit }: { lit: boolean }) {
  const { cables, bulbs } = useMemo(() => {
    const cables = STRANDS.map(([a, b]) => {
      const curve = new THREE.CatmullRomCurve3(catenary(a, b, 1.0, 24));
      return new THREE.TubeGeometry(curve, 64, 0.018, 5, false);
    });
    const bulbs: THREE.Vector3[] = [];
    for (const [a, b] of STRANDS) {
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const count = Math.round(length / 0.95);
      catenary(a, b, 1.0, count).forEach((p, i) => {
        if (i > 0 && i < count) bulbs.push(p.clone().setY(p.y - 0.22));
      });
    }
    return { cables, bulbs };
  }, []);
  useEffect(() => () => cables.forEach((c) => c.dispose()), [cables]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    bulbs.forEach((p, i) =>
      mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)),
    );
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [bulbs]);
  return (
    <group>
      {cables.map((geometry, i) => (
        <mesh key={i} geometry={geometry}>
          <meshStandardMaterial color={STEEL} roughness={0.6} />
        </mesh>
      ))}
      <instancedMesh ref={ref} args={[undefined, undefined, bulbs.length]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshBasicMaterial color="#ffd59a" toneMapped={false} />
      </instancedMesh>
      {POLES.map(([x, y, z]) => (
        <group key={`${x}-${z}`}>
          <mesh position={[x, (y + FLOOR_Y) / 2, z]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, y - FLOOR_Y, 10]} />
            <meshStandardMaterial
              color={STEEL}
              metalness={0.6}
              roughness={0.45}
            />
          </mesh>
          <mesh position={[x, FLOOR_Y + 0.6, z]}>
            <cylinderGeometry args={[0.45, 0.5, 1.2, 20]} />
            <meshStandardMaterial color={CONCRETE} roughness={0.9} />
          </mesh>
        </group>
      ))}
      <mesh
        position={[BRACKET[0], (BRACKET[1] + BULKHEAD.top) / 2, BRACKET[2]]}
      >
        <cylinderGeometry args={[0.06, 0.06, BRACKET[1] - BULKHEAD.top, 8]} />
        <meshStandardMaterial color={STEEL} metalness={0.6} roughness={0.45} />
      </mesh>
      {lit && (
        <>
          <pointLight
            position={[-9, 9.2, 0]}
            color="#ffcf8f"
            intensity={5}
            distance={16}
            decay={2}
          />
          <pointLight
            position={[2, 9.2, 10]}
            color="#ffcf8f"
            intensity={5}
            distance={16}
            decay={2}
          />
        </>
      )}
    </group>
  );
}

/** Concrete parapet round the roof edge, capped, with frameless glass above. */
function Parapet({ concrete }: { concrete: THREE.Texture }) {
  const sides: [Point, Point, number][] = [
    [[0, -0.6, -EDGE], [EDGE * 2 + 0.5, 4, 0.5], 0],
    [[0, -0.6, EDGE], [EDGE * 2 + 0.5, 4, 0.5], 0],
    [[-EDGE, -0.6, 0], [0.5, 4, EDGE * 2], 1],
    [[EDGE, -0.6, 0], [0.5, 4, EDGE * 2], 1],
  ];
  return (
    <group>
      {sides.map(([at, size, alongZ], i) => (
        <group key={i}>
          <Box
            position={at}
            size={size}
            color="#ffffff"
            map={concrete}
            roughness={0.9}
          />
          <Box
            position={[at[0], 1.47, at[2]]}
            size={[
              size[0] + (alongZ ? 0.12 : 0),
              0.14,
              size[2] + (alongZ ? 0 : 0.12),
            ]}
            color="#b7b4ad"
            roughness={0.7}
          />
          <mesh
            position={[at[0], 2.65, at[2]]}
            rotation={[0, alongZ ? Math.PI / 2 : 0, 0]}
            renderOrder={2}
          >
            <planeGeometry args={[alongZ ? EDGE * 2 : EDGE * 2 + 0.5, 2.3]} />
            <meshStandardMaterial
              color="#cfe0e4"
              transparent
              opacity={0.12}
              metalness={0.3}
              roughness={0.05}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <Box
            position={[at[0], 3.85, at[2]]}
            size={[alongZ ? 0.12 : size[0], 0.08, alongZ ? size[2] : 0.12]}
            color={STEEL}
            metal={0.7}
            roughness={0.35}
          />
        </group>
      ))}
    </group>
  );
}

/** The stair bulkhead: a stucco box, a steel door with a pull, a wall light, a vent. */
function Bulkhead({ concrete }: { concrete: THREE.Texture }) {
  const [x0, x1] = BULKHEAD.x;
  const [z0, z1] = BULKHEAD.z;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const height = BULKHEAD.top - FLOOR_Y;
  return (
    <group>
      <Box
        position={[cx, FLOOR_Y + height / 2, cz]}
        size={[x1 - x0, height, z1 - z0]}
        color="#c9c2b6"
        map={concrete}
        roughness={0.9}
      />
      <Box
        position={[cx, BULKHEAD.top + 0.12, cz]}
        size={[x1 - x0 + 0.3, 0.24, z1 - z0 + 0.3]}
        color={CONCRETE}
        roughness={0.8}
      />
      {/* Door on the side facing the terrace. */}
      <Box
        position={[10.2, 1.9, z1 + 0.04]}
        size={[3.0, 9.0, 0.1]}
        color="#2f3e36"
        metal={0.4}
        roughness={0.5}
      />
      <Box
        position={[10.2, 6.5, z1 + 0.06]}
        size={[3.4, 0.22, 0.14]}
        color={STEEL}
        metal={0.6}
        roughness={0.4}
      />
      {[8.6, 11.8].map((x) => (
        <Box
          key={x}
          position={[x, 1.9, z1 + 0.06]}
          size={[0.2, 9.2, 0.14]}
          color={STEEL}
          metal={0.6}
          roughness={0.4}
        />
      ))}
      <mesh position={[9.1, 1.9, z1 + 0.22]}>
        <cylinderGeometry args={[0.045, 0.045, 1.4, 10]} />
        <meshStandardMaterial color="#c9c9c6" metalness={1} roughness={0.25} />
      </mesh>
      {/* Wall light over the door. */}
      <Box
        position={[10.2, 7.4, z1 + 0.18]}
        size={[0.6, 0.35, 0.36]}
        color={STEEL}
        metal={0.5}
      />
      <mesh position={[10.2, 7.2, z1 + 0.18]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.2, 16]} />
        <meshBasicMaterial
          color="#ffe2b0"
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Exhaust fan on the roof of it. */}
      <Box
        position={[11.4, BULKHEAD.top + 0.9, -11.2]}
        size={[2, 1.3, 2]}
        color="#a9aaa8"
        metal={0.5}
        roughness={0.5}
      />
      <mesh
        position={[11.4, BULKHEAD.top + 1.56, -11.2]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[0.75, 24]} />
        <meshStandardMaterial color="#3b3d3e" metalness={0.6} roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Corten planters along the edge, full of grasses blowing one way. */
function Planter({
  from,
  to,
  corten,
  seed,
}: {
  from: [number, number];
  to: [number, number];
  corten: THREE.Texture;
  seed: number;
}) {
  const [x0, z0] = from;
  const [x1, z1] = to;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const sx = Math.max(Math.abs(x1 - x0), 1.2);
  const sz = Math.max(Math.abs(z1 - z0), 1.2);
  const blades = useMemo(() => {
    const random = seeded(seed);
    const out: {
      at: Point;
      h: number;
      tilt: number;
      spin: number;
      colour: string;
    }[] = [];
    const count = Math.round((sx * sz) / 0.03);
    for (let i = 0; i < Math.min(count, 700); i++) {
      out.push({
        at: [
          cx + (random() - 0.5) * (sx - 0.3),
          -0.55,
          cz + (random() - 0.5) * (sz - 0.3),
        ],
        h: 1.4 + random() * 1.4,
        tilt: 0.15 + random() * 0.35,
        spin: random() * Math.PI * 2,
        colour: ["#8c9a5a", "#a7a466", "#76874c", "#c2b277"][
          Math.floor(random() * 4)
        ],
      });
    }
    return out;
  }, [cx, cz, sx, sz, seed]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    blades.forEach(({ at, h, tilt, spin, colour }, i) => {
      // Lean every blade a little the same way, as in a breeze.
      q.setFromEuler(e.set(tilt, spin, 0.2));
      const up = new THREE.Vector3(0, h / 2, 0).applyQuaternion(q);
      m.compose(
        new THREE.Vector3(at[0] + up.x, at[1] + up.y, at[2] + up.z),
        q,
        new THREE.Vector3(0.05, h, 0.012),
      );
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(colour));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [blades]);
  return (
    <group>
      <Box
        position={[cx, -1.6, cz]}
        size={[sx, 2.0, sz]}
        color="#ffffff"
        map={corten}
        roughness={0.85}
      />
      <Box
        position={[cx, -0.58, cz]}
        size={[sx - 0.16, 0.04, sz - 0.16]}
        color="#3a2a1c"
        roughness={1}
      />
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, blades.length]}
        castShadow
      >
        <boxGeometry />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </instancedMesh>
    </group>
  );
}

/** A potted olive tree: a twisted trunk and silvery leaf clusters. */
function OliveTree({ position }: { position: Point }) {
  const clusters = useMemo(() => {
    const random = seeded(167);
    // Many small, loose clusters: an olive's canopy is airy, not a ball.
    return Array.from({ length: 70 }, () => {
      const angle = random() * Math.PI * 2;
      const reach = Math.sqrt(random()) * 1.5;
      return {
        at: [
          Math.cos(angle) * reach,
          4.2 + random() * 2.3,
          Math.sin(angle) * reach,
        ] as Point,
        r: 0.2 + random() * 0.22,
        colour: ["#7f8f6a", "#93a07e", "#6f7f5c", "#a3ad8f"][
          Math.floor(random() * 4)
        ],
      };
    });
  }, []);
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.85, 0.7, 1.8, 28]} />
        <meshStandardMaterial color="#d9d3c6" roughness={0.85} />
      </mesh>
      <mesh position={[0.1, 2.9, 0]} rotation={[0, 0, 0.12]} castShadow>
        <cylinderGeometry args={[0.1, 0.17, 2.6, 8]} />
        <meshStandardMaterial color="#5e5446" roughness={0.95} />
      </mesh>
      <mesh position={[-0.35, 3.9, 0.15]} rotation={[0.2, 0, 0.5]}>
        <cylinderGeometry args={[0.05, 0.09, 1.6, 6]} />
        <meshStandardMaterial color="#5e5446" roughness={0.95} />
      </mesh>
      {clusters.map(({ at, r, colour }, i) => (
        <mesh key={i} position={at} scale={[r, r * 0.75, r]} castShadow>
          <icosahedronGeometry args={[1, 3]} />
          <meshStandardMaterial color={colour} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

/** A teak outdoor sofa (or chair): slatted frame, deep cushions. Back at local +z. */
function TeakSeat({
  position,
  rotation,
  width,
  seats,
  teak,
  fabric,
  stripe,
}: {
  position: Point;
  rotation: number;
  width: number;
  seats: number;
  teak: THREE.Texture;
  fabric: THREE.Texture;
  stripe: THREE.Texture;
}) {
  const half = width / 2;
  const cushion = (width - 0.9) / seats;
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box
        position={[0, 0.75, 0]}
        size={[width, 0.3, 2.5]}
        color={TEAK}
        map={teak}
        roughness={0.6}
      />
      {[-half + 0.22, half - 0.22].map((x) => (
        <group key={x}>
          <Box
            position={[x, 1.25, 0]}
            size={[0.38, 1.0, 2.5]}
            color={TEAK}
            map={teak}
            roughness={0.6}
          />
          <Box
            position={[x, 0.3, -1.05]}
            size={[0.3, 0.6, 0.3]}
            color={TEAK}
            map={teak}
          />
          <Box
            position={[x, 0.3, 1.05]}
            size={[0.3, 0.6, 0.3]}
            color={TEAK}
            map={teak}
          />
        </group>
      ))}
      <Box
        position={[0, 1.7, 1.12]}
        size={[width, 1.9, 0.26]}
        color={TEAK}
        map={teak}
        roughness={0.6}
      />
      {Array.from({ length: seats }, (_, i) => {
        const x = -half + 0.45 + cushion * (i + 0.5);
        return (
          <group key={i}>
            <RoundedBox
              args={[cushion - 0.05, 0.5, 2.1]}
              radius={0.14}
              smoothness={4}
              position={[x, 1.15, -0.1]}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color={CUSHION}
                map={fabric}
                roughness={0.95}
                sheen={0.4}
                sheenColor="#efe9dd"
              />
            </RoundedBox>
            <RoundedBox
              args={[cushion - 0.1, 1.55, 0.45]}
              radius={0.16}
              smoothness={4}
              position={[x, 2.05, 0.82]}
              rotation={[-0.14, 0, 0]}
              castShadow
              receiveShadow
            >
              <meshPhysicalMaterial
                color={CUSHION}
                map={fabric}
                roughness={0.95}
                sheen={0.4}
                sheenColor="#efe9dd"
              />
            </RoundedBox>
          </group>
        );
      })}
      <RoundedBox
        args={[0.95, 0.9, 0.26]}
        radius={0.12}
        smoothness={4}
        position={[-half + 1.0, 1.85, 0.5]}
        rotation={[-0.25, 0, -0.15]}
        castShadow
      >
        <meshStandardMaterial map={stripe} roughness={1} />
      </RoundedBox>
    </group>
  );
}

/** A rope-woven lounge chair on a teak frame, with a seat pad. Back at local +z. */
function RopeChair({
  position,
  rotation,
  teak,
  rope,
  fabric,
}: {
  position: Point;
  rotation: number;
  teak: THREE.Texture;
  rope: THREE.Texture;
  fabric: THREE.Texture;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-1.1, 1.1].map((x) => (
        <group key={x}>
          {/* Side frame: a sled of teak. */}
          <Box
            position={[x, 0.08, 0]}
            size={[0.16, 0.16, 2.3]}
            color={TEAK}
            map={teak}
          />
          <Box
            position={[x, 0.75, -0.95]}
            size={[0.16, 1.4, 0.16]}
            color={TEAK}
            map={teak}
          />
          <Box
            position={[x, 1.55, 0.95]}
            size={[0.16, 3.0, 0.16]}
            color={TEAK}
            map={teak}
            rotation={[0.12, 0, 0]}
          />
          <Box
            position={[x, 1.5, 0]}
            size={[0.24, 0.12, 2.2]}
            color={TEAK}
            map={teak}
          />
        </group>
      ))}
      <Box
        position={[0, 0.85, 0]}
        size={[2.2, 0.12, 2.0]}
        color={TEAK}
        map={teak}
      />
      <mesh position={[0, 1.9, 0.98]} rotation={[0.12, 0, 0]}>
        <planeGeometry args={[2.05, 2.2]} />
        <meshStandardMaterial
          map={rope}
          transparent
          alphaTest={0.35}
          side={THREE.DoubleSide}
          roughness={0.9}
        />
      </mesh>
      <RoundedBox
        args={[1.95, 0.36, 1.85]}
        radius={0.12}
        smoothness={4}
        position={[0, 1.1, -0.05]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={CUSHION}
          map={fabric}
          roughness={0.95}
          sheen={0.4}
          sheenColor="#efe9dd"
        />
      </RoundedBox>
    </group>
  );
}

/** A teak slat table; its top sits where every room's does. */
function TeakTable({ top, teak }: { top: THREE.Texture; teak: THREE.Texture }) {
  return (
    <group>
      <Box
        position={[0, -0.19, 0]}
        size={[8.5, 0.36, 7.65]}
        color="#c08a5a"
        map={top}
        roughness={0.55}
      />
      <Box
        position={[0, -0.45, 0]}
        size={[7.9, 0.2, 7.05]}
        color={TEAK}
        map={teak}
        roughness={0.6}
      />
      {[-3.8, 3.8].flatMap((x) =>
        [-3.3, 3.3].map((z) => (
          <Box
            key={`${x}-${z}`}
            position={[x, -1.55, z]}
            size={[0.35, 2.1, 0.35]}
            color={TEAK}
            map={teak}
            roughness={0.6}
          />
        )),
      )}
      <Box
        position={[0, -2.1, 0]}
        size={[7.4, 0.15, 6.4]}
        color={TEAK}
        map={teak}
        roughness={0.6}
      />
    </group>
  );
}

/** A tall black floor lantern with a candle glowing inside. */
function FloorLantern({ position }: { position: Point }) {
  return (
    <group position={position}>
      {[
        [-0.4, -0.4],
        [0.4, -0.4],
        [-0.4, 0.4],
        [0.4, 0.4],
      ].map(([x, z]) => (
        <Box
          key={`${x}-${z}`}
          position={[x, 1.4, z]}
          size={[0.07, 2.8, 0.07]}
          color={STEEL}
          metal={0.5}
        />
      ))}
      <Box
        position={[0, 0.06, 0]}
        size={[0.95, 0.12, 0.95]}
        color={STEEL}
        metal={0.5}
      />
      <Box
        position={[0, 2.85, 0]}
        size={[1.0, 0.14, 1.0]}
        color={STEEL}
        metal={0.5}
      />
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.7, 18]} />
        <meshStandardMaterial
          color="#f2ead8"
          emissive="#ffc27a"
          emissiveIntensity={0.5}
          roughness={0.6}
        />
      </mesh>
      <mesh position={[0, 0.95, 0]}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshBasicMaterial color="#ffd59a" toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.4, 0]} renderOrder={2}>
        <boxGeometry args={[0.8, 2.7, 0.8]} />
        <meshStandardMaterial
          color="#f3e7cf"
          transparent
          opacity={0.1}
          roughness={0.1}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** A market umbrella, furled for the evening. */
function Umbrella({ position }: { position: Point }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.7, 0.75, 0.4, 24]} />
        <meshStandardMaterial color={STEEL} metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 5.0, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 9.6, 10]} />
        <meshStandardMaterial color={TEAK} roughness={0.6} />
      </mesh>
      <mesh position={[0, 7.0, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.42, 4.2, 12]} />
        <meshStandardMaterial color="#e3dccd" roughness={0.9} />
      </mesh>
      <mesh position={[0, 9.9, 0]}>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color={TEAK} roughness={0.5} />
      </mesh>
    </group>
  );
}

const ROOF_FLOOR_SHADES: [number, number, number, number, number, number][] = [
  [0, RUG_Y, -6.3, 9.4, 2.5, 0.65], // sofa
  [0, RUG_Y, 6.2, 2.4, 2.3, 0.55], // chairs
  [-6.2, RUG_Y, 0, 2.3, 2.4, 0.55],
  [6.2, RUG_Y, 0, 2.3, 2.4, 0.55],
  [0, RUG_Y, 0, 8, 7.2, 0.3], // under the table
  [10.2, FLOOR_Y, -10.7, 6.4, 5.4, 0.5], // bulkhead
  [10, FLOOR_Y, 10.8, 1.6, 1.6, 0.55], // olive tree
];

export function Rooftop({ quality }: { quality: Quality }) {
  const anisotropy = quality === "low" ? 2 : 8;
  const [floorSource, topSource, woodSource, fabricSource] = useTexture([
    "/textures/floor.jpg",
    "/textures/table-top.webp",
    "/textures/board-wood.webp",
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
    const skyline = makeSkyline();
    skyline.wrapS = THREE.RepeatWrapping;
    skyline.repeat.set(2, 1);
    const concrete = makeConcrete();
    concrete.repeat.set(6, 1);
    const corten = makeCorten();
    corten.repeat.set(4, 1);
    const stripe = makeStripe();
    stripe.repeat.set(1, 1);
    return {
      deck: prepare(floorSource, [5, 5]),
      top: prepare(topSource),
      teak: prepare(woodSource),
      fabric: prepare(fabricSource, [1.5, 1.5]),
      sky: makeSky(),
      stars: makeStars(),
      skyline,
      rug: makeRug(),
      corten,
      concrete,
      rope: makeRope(),
      stripe,
      ...makeOcclusionTextures(),
    };
  }, [floorSource, topSource, woodSource, fabricSource, anisotropy]);
  useEffect(() => () => Object.values(t).forEach((tex) => tex.dispose()), [t]);
  return (
    <group>
      {/* The sky, the stars and a rising moon; then the city in a ring. */}
      <mesh position={[0, 4, 0]} renderOrder={-3}>
        <sphereGeometry args={[100, 32, 24]} />
        <meshBasicMaterial
          map={t.sky}
          side={THREE.BackSide}
          toneMapped={false}
          fog={false}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 4, 0]} renderOrder={-2}>
        <sphereGeometry args={[98, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshBasicMaterial
          map={t.stars}
          side={THREE.BackSide}
          transparent
          toneMapped={false}
          fog={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[55, 38, -70]}
        onUpdate={(moon) => moon.lookAt(0, 4, 0)}
        renderOrder={-1}
      >
        <circleGeometry args={[2.6, 40]} />
        <meshBasicMaterial color="#f6f1df" toneMapped={false} fog={false} />
      </mesh>
      <mesh position={[0, 12, 0]} renderOrder={-1}>
        <cylinderGeometry args={[90, 90, 80, 96, 1, true]} />
        <meshBasicMaterial
          map={t.skyline}
          side={THREE.BackSide}
          transparent
          toneMapped={false}
          fog={false}
          depthWrite={false}
        />
      </mesh>

      {/* The roof: teak decking, the rug, the parapet and its glass. */}
      <Box
        position={[0, -2.73, 0]}
        size={[EDGE * 2, 0.25, EDGE * 2]}
        color="#8a5a3a"
        map={t.deck}
        roughness={0.6}
      />
      <Box
        position={[0, -4.5, 0]}
        size={[EDGE * 2 + 0.6, 3.5, EDGE * 2 + 0.6]}
        color="#5c5a57"
        roughness={0.9}
      />
      <Box
        position={[0, -2.57, 0]}
        size={[13, 0.065, 11.5]}
        color="#ffffff"
        map={t.rug}
        roughness={1}
      />
      <Parapet concrete={t.concrete} />
      <Bulkhead concrete={t.concrete} />
      <StringLights lit={quality !== "low"} />

      <Planter
        from={[-12.4, -10.5]}
        to={[-12.4, 10.5]}
        corten={t.corten}
        seed={171}
      />
      <Planter
        from={[-10.5, 12.4]}
        to={[6.5, 12.4]}
        corten={t.corten}
        seed={173}
      />
      <Planter
        from={[12.4, -6.5]}
        to={[12.4, 7.5]}
        corten={t.corten}
        seed={179}
      />
      <OliveTree position={[10, FLOOR_Y, 10.8]} />
      <Umbrella position={[-9.6, FLOOR_Y, -9.6]} />
      <FloorLantern position={[-5.9, FLOOR_Y, -6.6]} />
      <FloorLantern position={[5.9, FLOOR_Y, -6.6]} />

      {/* The party's sofa, chairs and table. */}
      <TeakSeat
        position={[0, FLOOR_Y, -6.3]}
        rotation={Math.PI}
        width={9.4}
        seats={3}
        teak={t.teak}
        fabric={t.fabric}
        stripe={t.stripe}
      />
      <RopeChair
        position={[0, FLOOR_Y, 6.2]}
        rotation={0}
        teak={t.teak}
        rope={t.rope}
        fabric={t.fabric}
      />
      <RopeChair
        position={[-6.2, FLOOR_Y, 0]}
        rotation={-Math.PI / 2}
        teak={t.teak}
        rope={t.rope}
        fabric={t.fabric}
      />
      <RopeChair
        position={[6.2, FLOOR_Y, 0]}
        rotation={Math.PI / 2}
        teak={t.teak}
        rope={t.rope}
        fabric={t.fabric}
      />
      <TeakTable top={t.top} teak={t.teak} />

      {/* Shade along the parapet and under furniture. */}
      <Occlusion
        map={t.edge}
        position={[0, -2.6, -12.65]}
        size={[27, 1.2]}
        opacity={0.4}
      />
      <Occlusion
        map={t.edge}
        position={[12.65, -2.6, 0]}
        size={[27, 1.2]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        opacity={0.4}
      />
      <Occlusion
        map={t.edge}
        position={[0, -2.6, 12.65]}
        size={[27, 1.2]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
        opacity={0.4}
      />
      <Occlusion
        map={t.edge}
        position={[-12.65, -2.6, 0]}
        size={[27, 1.2]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        opacity={0.4}
      />
      {ROOF_FLOOR_SHADES.map(([x, y, z, w, d, opacity], i) => (
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
