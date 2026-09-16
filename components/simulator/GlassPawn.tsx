"use client";

import * as THREE from "three";
import type { PlayerColor } from "@/lib/board/types";

export const GLASS_PAWN_HEIGHT = 0.115;

// A closed, flat disc with softly rounded shoulders and a polished bottom edge.
const PROFILE = [
  [0, 0.005],
  [0.15, 0.005],
  [0.169, 0.008],
  [0.18, 0.016],
  [0.185, 0.027],
  [0.186, 0.045],
  [0.186, 0.082],
  [0.182, 0.098],
  [0.173, 0.109],
  [0.156, GLASS_PAWN_HEIGHT],
  [0, GLASS_PAWN_HEIGHT],
].map(([radius, height]) => new THREE.Vector2(radius, height));

// Board ink samples converted from the artwork's Adobe RGB profile to sRGB.
// Use the same hue for the surface and absorption so glass doesn't shift it.
const GLASS: Record<PlayerColor, { tint: THREE.Color; absorption: string }> = {
  red: { tint: new THREE.Color("#ee1c24").multiplyScalar(0.72), absorption: "#ee1c24" },
  green: { tint: new THREE.Color("#48b85e").multiplyScalar(0.72), absorption: "#48b85e" },
  yellow: { tint: new THREE.Color("#fef201").multiplyScalar(0.72), absorption: "#fef201" },
  blue: { tint: new THREE.Color("#2e3092").multiplyScalar(0.72), absorption: "#2e3092" },
};

export function GlassPawn({ color }: { color: PlayerColor }) {
  const glass = GLASS[color];
  return (
    <group>
      {/* A faint colored contact shadow keeps the transparent disc grounded. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[0.176, 48]} />
        <meshBasicMaterial
          color={glass.absorption}
          transparent
          opacity={0.16}
          depthWrite={false}
        />
      </mesh>
      <mesh receiveShadow>
        <latheGeometry args={[PROFILE, 64]} />
        <meshPhysicalMaterial
          color={glass.tint}
          toneMapped={false}
          metalness={0}
          roughness={0.12}
          transmission={0.28}
          thickness={GLASS_PAWN_HEIGHT}
          ior={1.49}
          attenuationColor={glass.absorption}
          attenuationDistance={0.08}
          clearcoat={1}
          clearcoatRoughness={0.055}
          envMapIntensity={1.1}
          opacity={1}
        />
      </mesh>
    </group>
  );
}
