"use client";

import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";

export const SINDBAD_PAWN_HEIGHT = 0.39;

// The Sindbad board's ship timber, rope, chart paper and brass
// (designs/board-sindbad.svg).
const TIMBER = "#4a3020";
const ROPE = "#c9a66b";
const PAPER = "#f3e4bf";
const BRASS = "#c9a04a";
const LAMP = "#ffd27a";

// The board's harbour colours: coral, sea green, amber, ocean blue.
const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#d04a3c",
  green: "#2f9474",
  yellow: "#f0b13c",
  blue: "#3168b0",
  orange: "#d86a1e",
  black: "#2c3440",
};

const TOWER_BOTTOM = 0.098;
const TOWER_TOP = 0.066;
const TOWER_HEIGHT = 0.2;
const TOWER_Y = 0.05 + TOWER_HEIGHT / 2;

/** The tower's radius `t` of the way up (0 at its foot, 1 at the gallery). */
const towerRadius = (t: number) => TOWER_BOTTOM + (TOWER_TOP - TOWER_BOTTOM) * t;

/**
 * A harbour lighthouse for a seafaring board: a tower in the seat's colour
 * banded in chart-paper cream, a brass gallery round a lit lamp, and a
 * timber plinth ringed in rope.
 */
export function SindbadPawn({
  color,
  colorBlind = false,
}: {
  color: PlayerColor;
  /** The colour-blind palette, with the seat's symbol on the tower. */
  colorBlind?: boolean;
}) {
  const towerColor = (colorBlind ? COLOR_BLIND_COLORS : PAWN_COLORS)[color];
  const capColor = new THREE.Color(towerColor).offsetHSL(0, 0, -0.14);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.16, 40]} />
        <meshBasicMaterial color="#0b2233" transparent opacity={0.26} depthWrite={false} />
      </mesh>
      {/* Timber plinth, ringed in rope */}
      <mesh position={[0, 0.024, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.125, 0.138, 0.048, 32]} />
        <meshPhysicalMaterial color={TIMBER} roughness={0.55} clearcoat={0.3} />
      </mesh>
      <mesh position={[0, 0.026, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.132, 0.012, 10, 40]} />
        <meshStandardMaterial color={ROPE} roughness={0.9} />
      </mesh>
      {/* Tower, banded in cream */}
      <mesh position={[0, TOWER_Y, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TOWER_TOP, TOWER_BOTTOM, TOWER_HEIGHT, 32]} />
        <meshPhysicalMaterial color={towerColor} roughness={0.3} clearcoat={0.6} clearcoatRoughness={0.15} />
      </mesh>
      {[0.3, 0.68].map((t) => (
        <mesh key={t} position={[0, 0.05 + TOWER_HEIGHT * t, 0]} castShadow>
          <cylinderGeometry args={[towerRadius(t + 0.07) + 0.003, towerRadius(t - 0.07) + 0.003, TOWER_HEIGHT * 0.14, 32]} />
          <meshPhysicalMaterial color={PAPER} roughness={0.35} clearcoat={0.5} />
        </mesh>
      ))}
      {/* Brass gallery and the lit lamp */}
      <mesh position={[0, 0.256, 0]} castShadow>
        <cylinderGeometry args={[0.088, 0.08, 0.014, 32]} />
        <meshPhysicalMaterial color={BRASS} roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.288, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.05, 16]} />
        <meshStandardMaterial color={LAMP} emissive={LAMP} emissiveIntensity={0.85} roughness={0.2} />
      </mesh>
      {/* Lantern cap and brass ball */}
      <mesh position={[0, 0.336, 0]} castShadow>
        <coneGeometry args={[0.064, 0.05, 32]} />
        <meshPhysicalMaterial color={capColor} roughness={0.3} clearcoat={0.6} />
      </mesh>
      <mesh position={[0, SINDBAD_PAWN_HEIGHT - 0.016, 0]} castShadow>
        <sphereGeometry args={[0.016, 16, 12]} />
        <meshPhysicalMaterial color={BRASS} roughness={0.25} metalness={0.8} />
      </mesh>
      {colorBlind && (
        // A medallion on the tower, turned to face the camera.
        <Billboard position={[0, TOWER_Y, 0]}>
          <group position={[0, 0, 0.1]}>
            <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.058} />
          </group>
        </Billboard>
      )}
    </group>
  );
}
