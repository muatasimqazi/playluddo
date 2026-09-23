"use client";

import * as THREE from "three";
import type { PlayerColor } from "@/lib/board/types";

export const ALADDIN_PAWN_HEIGHT = 0.42;

const GOLD = "#d4af37";
const GOLD_DARK = "#8a6c1f";

const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#c0272d",
  green: "#1c7a4d",
  yellow: "#d9a91a",
  blue: "#1c3f8f",
};

/** A minaret-domed piece echoing the board's navy-and-gold Arabian motif. */
export function AladdinPawn({ color }: { color: PlayerColor }) {
  const pawnColor = PAWN_COLORS[color];
  const dark = new THREE.Color(pawnColor).offsetHSL(0, 0, -0.14);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.17, 40]} />
        <meshBasicMaterial color="#0a1836" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {/* Gold foot ring */}
      <mesh position={[0, 0.018, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.15, 0.16, 0.036, 32]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.3} metalness={0.6} clearcoat={0.6} />
      </mesh>
      {/* Body */}
      <mesh position={[0, 0.075, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.1, 0.14, 0.09, 32]} />
        <meshPhysicalMaterial color={dark} roughness={0.28} clearcoat={0.7} clearcoatRoughness={0.12} />
      </mesh>
      {/* Gold waistband */}
      <mesh position={[0, 0.128, 0]} castShadow>
        <torusGeometry args={[0.1, 0.014, 12, 28]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.25} metalness={0.65} />
      </mesh>
      {/* Upper taper */}
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.095, 0.145, 32]} />
        <meshPhysicalMaterial color={pawnColor} roughness={0.22} clearcoat={0.85} clearcoatRoughness={0.1} />
      </mesh>
      {/* Minaret dome */}
      <mesh position={[0, 0.29, 0]} castShadow>
        <sphereGeometry args={[0.052, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color={pawnColor} roughness={0.2} clearcoat={0.9} clearcoatRoughness={0.08} />
      </mesh>
      {/* Gold finial spike */}
      <mesh position={[0, 0.35, 0]} castShadow>
        <coneGeometry args={[0.018, 0.07, 12]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.2} metalness={0.7} />
      </mesh>
      {/* Gem tip */}
      <mesh position={[0, ALADDIN_PAWN_HEIGHT - 0.02, 0]} castShadow>
        <octahedronGeometry args={[0.02, 0]} />
        <meshPhysicalMaterial color={GOLD_DARK} roughness={0.1} metalness={0.3} clearcoat={1} />
      </mesh>
    </group>
  );
}
