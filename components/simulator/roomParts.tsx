"use client";

// Building blocks shared by every room around the table (Apartment.tsx,
// MahoganyRoom.tsx): a lit box, and the soft occlusion decals that ground
// furniture where the key light's shadow camera doesn't reach.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Point } from "@/lib/presentation/board";

export function Box({
  position,
  size,
  color,
  round = 0,
  map,
  metal = 0,
  roughness = 0.72,
  rotation,
  fabric = false,
  clearcoat = 0,
}: {
  position: Point;
  size: Point;
  color: string;
  round?: number;
  map?: THREE.Texture;
  metal?: number;
  roughness?: number;
  rotation?: Point;
  /** Woven upholstery: a soft sheen at grazing angles instead of a plastic highlight. */
  fabric?: boolean;
  /** Sealed stone and lacquer: a thin glossy coat over a rougher base. */
  clearcoat?: number;
}) {
  const material = fabric ? (
    <meshPhysicalMaterial
      color={color}
      map={map}
      roughness={0.95}
      sheen={0.6}
      sheenRoughness={0.6}
      sheenColor="#b8b2a6"
    />
  ) : clearcoat ? (
    <meshPhysicalMaterial
      color={color}
      map={map}
      roughness={roughness}
      metalness={metal}
      clearcoat={clearcoat}
      clearcoatRoughness={0.12}
    />
  ) : (
    <meshStandardMaterial
      color={color}
      map={map}
      roughness={roughness}
      metalness={metal}
    />
  );
  return round ? (
    <RoundedBox
      position={position}
      args={size}
      radius={round}
      smoothness={3}
      rotation={rotation}
      castShadow
      receiveShadow
    >
      {material}
    </RoundedBox>
  ) : (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      {material}
    </mesh>
  );
}

/**
 * Soft occlusion maps for the places light can't reach: under furniture and
 * where walls meet the floor and ceiling. The key light's shadow camera only
 * covers the table, so without these the sofa, kitchen and pots float. They're
 * alpha masks (alphaMap reads green: white = full shade on opaque black),
 * drawn once and reused by every decal.
 */
export function makeOcclusionTextures() {
  const draw = (
    paint: (ctx: CanvasRenderingContext2D) => void,
    w = 256,
    h = 256,
  ) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the room shading.");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    paint(ctx);
    return new THREE.CanvasTexture(canvas);
  };
  // A footprint blurred well past its edges: stretched per piece of furniture.
  const blob = draw((ctx) => {
    ctx.filter = "blur(16px)";
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.roundRect(38, 38, 180, 180, 30);
    ctx.fill();
  });
  // Darkest against the wall (the top of the image), gone a short way out.
  const edge = draw(
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, "#fff");
      g.addColorStop(0.35, "#5a5a5a");
      g.addColorStop(1, "#000");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 64);
    },
    4,
    64,
  );
  return { blob, edge };
}

export function Occlusion({
  map,
  position,
  size,
  opacity = 0.5,
  rotation = [-Math.PI / 2, 0, 0],
  light = false,
}: {
  map: THREE.Texture;
  position: Point;
  size: [number, number];
  opacity?: number;
  rotation?: Point;
  /** Adds warm daylight instead of taking light away. */
  light?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} renderOrder={1}>
      <planeGeometry args={size} />
      <meshBasicMaterial
        color={light ? "#fff1d6" : "#1d1810"}
        blending={light ? THREE.AdditiveBlending : THREE.NormalBlending}
        alphaMap={map}
        transparent
        opacity={opacity}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Deterministic, so the room is the same room on every mount and device. */
export function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

export function canvasTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  color = true,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the room's textures.");
  paint(ctx);
  const t = new THREE.CanvasTexture(canvas);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function grain(
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

/**
 * Marble veining inside a rect: a few bold veins and finer threads that
 * wander roughly top to bottom. Clipped, so tiles keep their own stone.
 */
export function drawVeins(
  ctx: CanvasRenderingContext2D,
  [left, top, width, height]: [number, number, number, number],
  [major, minor]: [string, string],
  seed: number,
) {
  const random = seeded(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.lineCap = "round";
  const step = Math.max(width, height) / 36;
  for (let v = 0; v < 14; v++) {
    const bold = v < 5;
    ctx.filter = bold ? "blur(1.5px)" : "blur(0.8px)";
    ctx.strokeStyle = bold ? major : minor;
    ctx.lineWidth = bold ? 2.5 + random() * 3 : 1;
    let x = left + random() * width,
      y = top - 20;
    let angle = Math.PI / 2 + (random() - 0.5) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (y < top + height + 20 && x > left - 40 && x < left + width + 40) {
      angle += (random() - 0.5) * 0.7;
      angle = THREE.MathUtils.clamp(angle, 0.3, Math.PI - 0.3);
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Many boxes in one draw call: panels, beams, books. */
export function BoxInstances({
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
