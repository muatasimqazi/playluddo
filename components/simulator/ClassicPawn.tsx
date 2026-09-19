"use client";

import * as THREE from "three";
import type { PlayerColor } from "@/lib/board/types";

export const CLASSIC_PAWN_HEIGHT = 0.4;

const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#e2262e",
  green: "#31a65b",
  yellow: "#f2c400",
  blue: "#224c9e",
};

export function ClassicPawn({ color }: { color: PlayerColor }) {
  const pawnColor = PAWN_COLORS[color];
  const dark = new THREE.Color(pawnColor).offsetHSL(0, 0, -0.12);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.165, 40]} />
        <meshBasicMaterial color="#11130f" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.045, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.135, 0.17, 0.09, 40]} />
        <meshPhysicalMaterial color={dark} roughness={0.24} clearcoat={0.75} clearcoatRoughness={0.12} />
      </mesh>
      <mesh position={[0, 0.16, 0]} castShadow>
        <cylinderGeometry args={[0.065, 0.125, 0.19, 40]} />
        <meshPhysicalMaterial color={pawnColor} roughness={0.2} clearcoat={0.85} clearcoatRoughness={0.1} />
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow>
        <sphereGeometry args={[0.105, 32, 20]} />
        <meshPhysicalMaterial color={pawnColor} roughness={0.18} clearcoat={0.9} clearcoatRoughness={0.08} />
      </mesh>
    </group>
  );
}
