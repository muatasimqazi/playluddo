"use client";

import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";

export const CINDERELLA_PAWN_HEIGHT = 0.4;

// The Cinderella board's midnight, gold and pearl (designs/board-cinderella.svg).
const MIDNIGHT = "#1f2552";
const GOLD = "#d9b65a";
const PEARL = "#fbf3ea";

// The board's yards: rose, mint, crystal blue, and gold for yellow (its
// pumpkin is the hexagon's orange seat), with a dusk violet for black.
const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#d45a88",
  green: "#3fa78a",
  yellow: "#e8b442",
  blue: "#4f8fd9",
  orange: "#e07b26",
  black: "#4a4466",
};

// A ball gown, foot to waist, as it comes off a lathe.
const GOWN = [
  [0, 0.04],
  [0.122, 0.04],
  [0.12, 0.058],
  [0.104, 0.095],
  [0.08, 0.145],
  [0.058, 0.195],
  [0.042, 0.235],
  [0, 0.235],
].map(([radius, height]) => new THREE.Vector2(radius, height));

const TIARA_Y = 0.358;

/**
 * A princess for the midnight-ball board: a ball gown in the seat's colour
 * on a midnight plinth rimmed in gold, a gold sash, a pearl face and a gold
 * tiara.
 */
export function CinderellaPawn({
  color,
  colorBlind = false,
}: {
  color: PlayerColor;
  /** The colour-blind palette, with the seat's symbol on the gown. */
  colorBlind?: boolean;
}) {
  const gownColor = (colorBlind ? COLOR_BLIND_COLORS : PAWN_COLORS)[color];
  const bodiceColor = new THREE.Color(gownColor).offsetHSL(0, 0, -0.1);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.16, 40]} />
        <meshBasicMaterial color="#0b0f26" transparent opacity={0.26} depthWrite={false} />
      </mesh>
      {/* Midnight plinth, rimmed in gold */}
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.128, 0.138, 0.04, 32]} />
        <meshPhysicalMaterial color={MIDNIGHT} roughness={0.35} clearcoat={0.6} />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.128, 0.007, 10, 40]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.25} metalness={0.8} />
      </mesh>
      {/* Ball gown, gold sash and bodice */}
      <mesh castShadow receiveShadow>
        <latheGeometry args={[GOWN, 40]} />
        <meshPhysicalMaterial color={gownColor} roughness={0.4} clearcoat={0.5} clearcoatRoughness={0.2} />
      </mesh>
      <mesh position={[0, 0.235, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.042, 0.008, 10, 32]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.25} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.262, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.04, 0.05, 24]} />
        <meshPhysicalMaterial color={bodiceColor} roughness={0.35} clearcoat={0.5} />
      </mesh>
      {/* Pearl face */}
      <mesh position={[0, 0.322, 0]} castShadow>
        <sphereGeometry args={[0.042, 24, 18]} />
        <meshPhysicalMaterial color={PEARL} roughness={0.3} clearcoat={0.8} />
      </mesh>
      {/* Gold tiara: a band with five points */}
      <mesh position={[0, TIARA_Y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.03, 0.006, 8, 28]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.2} metalness={0.85} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const angle = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(angle) * 0.03, TIARA_Y + 0.016, Math.cos(angle) * 0.03]} castShadow>
            <coneGeometry args={[0.009, i === 0 ? 0.032 : 0.022, 8]} />
            <meshPhysicalMaterial color={GOLD} roughness={0.2} metalness={0.85} />
          </mesh>
        );
      })}
      {colorBlind && (
        <Billboard position={[0, 0.13, 0]}>
          <group position={[0, 0, 0.11]}>
            <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.058} />
          </group>
        </Billboard>
      )}
    </group>
  );
}
