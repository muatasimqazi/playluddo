"use client";

// Building blocks shared by every room around the table (Apartment.tsx,
// MahoganyRoom.tsx): a lit box, and the soft occlusion decals that ground
// furniture where the key light's shadow camera doesn't reach.
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
