"use client";

import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";

export const RUG_PAWN_HEIGHT = 0.42;

// The rug's own palette (designs/board-rug.svg): walnut, and the ivory of
// its borders and guls.
const WALNUT = "#5a3a2c";
const IVORY = "#ede0c4";

// The rug's natural dyes, a little brighter so a matte wool ball still
// reads as the seat's colour at the table: madder, green, ochre, indigo.
const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#b8382c",
  green: "#3f8462",
  yellow: "#e2a531",
  blue: "#2f4f8c",
  orange: "#cc6a24",
  black: "#35302e",
};

const WOOL_Y = 0.152;
const WOOL_RADIUS = 0.112;
// Yarn wound round the ball, as [tilt from upright, turn about the
// shaft]: three upright loops a third of a turn apart, and one slanting
// round the middle, like a ball wound by hand.
const WRAPS: [number, number][] = [
  [0, 0],
  [0, Math.PI / 3],
  [0, (2 * Math.PI) / 3],
  [Math.PI / 2 + 0.4, 0.5],
];

/**
 * A drop spindle full of dyed wool, what a Balochi weaver spins the rug's
 * yarn on: a turned walnut whorl with an ivory band, a matte wound ball in
 * the seat's dye, and the spindle's shaft rising out of it.
 */
export function RugPawn({
  color,
  colorBlind = false,
}: {
  color: PlayerColor;
  /** The colour-blind palette, with the seat's symbol on the wool. */
  colorBlind?: boolean;
}) {
  const woolColor = (colorBlind ? COLOR_BLIND_COLORS : PAWN_COLORS)[color];
  const yarn = new THREE.Color(woolColor).offsetHSL(0, -0.04, -0.1);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.16, 40]} />
        <meshBasicMaterial color="#2b1b15" transparent opacity={0.24} depthWrite={false} />
      </mesh>
      {/* Turned walnut whorl, with an ivory band */}
      <mesh position={[0, 0.022, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.118, 0.135, 0.044, 40]} />
        <meshPhysicalMaterial color={WALNUT} roughness={0.5} clearcoat={0.35} clearcoatRoughness={0.3} />
      </mesh>
      <mesh position={[0, 0.034, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.124, 0.008, 10, 40]} />
        <meshStandardMaterial color={IVORY} roughness={0.7} />
      </mesh>
      {/* Wound wool */}
      <mesh position={[0, WOOL_Y, 0]} scale={[1, 0.94, 1]} castShadow receiveShadow>
        <sphereGeometry args={[WOOL_RADIUS, 32, 24]} />
        <meshStandardMaterial color={woolColor} roughness={0.95} />
      </mesh>
      {WRAPS.map(([tilt, turn], i) => (
        <group key={i} position={[0, WOOL_Y, 0]} rotation={[0, turn, 0]} scale={[1, 0.94, 1]}>
          <mesh rotation={[tilt, 0, 0]} castShadow>
            <torusGeometry args={[WOOL_RADIUS, 0.009, 8, 40]} />
            <meshStandardMaterial color={yarn} roughness={1} />
          </mesh>
        </group>
      ))}
      {/* The spindle's shaft and its ivory knob */}
      <mesh position={[0, 0.315, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.016, 0.13, 12]} />
        <meshPhysicalMaterial color={WALNUT} roughness={0.45} clearcoat={0.4} />
      </mesh>
      <mesh position={[0, RUG_PAWN_HEIGHT - 0.022, 0]} castShadow>
        <sphereGeometry args={[0.022, 16, 12]} />
        <meshStandardMaterial color={IVORY} roughness={0.55} />
      </mesh>
      {colorBlind && (
        // A medallion on the wool, turned to face the camera.
        <Billboard position={[0, WOOL_Y, 0]}>
          <group position={[0, 0, 0.115]}>
            <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.062} />
          </group>
        </Billboard>
      )}
    </group>
  );
}
