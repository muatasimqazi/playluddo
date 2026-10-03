"use client";

import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";

export const BOWS_PAWN_HEIGHT = 0.42;

// The Pink Bows board's rosette white and pearl (designs/board-bows.svg).
const ROSETTE = "#ffffff";
const PEARL = "#f6e9ef";

// The board's yards: bubblegum, mint, lilac, and butter for yellow (its
// peach is the hexagon's orange seat), with a plum grey for black.
const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#ec5f9e",
  green: "#4dbf9f",
  yellow: "#f2c94c",
  blue: "#a07bd8",
  orange: "#f6a04d",
  black: "#5b4b63",
};

// A satin peg, foot to neck, as it comes off a lathe.
const PEG = [
  [0, 0.04],
  [0.1, 0.04],
  [0.1, 0.058],
  [0.072, 0.09],
  [0.05, 0.16],
  [0.044, 0.22],
  [0.058, 0.24],
  [0.03, 0.258],
  [0, 0.258],
].map(([radius, height]) => new THREE.Vector2(radius, height));

const HEAD_Y = 0.3;
const BOW_Y = 0.37;

/**
 * A hair-bow peg for the ribbons-and-lace board: a satin peg in the seat's
 * colour on a white rosette edged in pearl, with a satin bow in a lighter
 * shade of it on top, tied with a pearl.
 */
export function BowsPawn({
  color,
  colorBlind = false,
}: {
  color: PlayerColor;
  /** The colour-blind palette, with the seat's symbol on the peg. */
  colorBlind?: boolean;
}) {
  const pegColor = (colorBlind ? COLOR_BLIND_COLORS : PAWN_COLORS)[color];
  const bowColor = new THREE.Color(pegColor).offsetHSL(0, 0, 0.08);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.16, 40]} />
        <meshBasicMaterial color="#6a2a48" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      {/* Rosette, edged in pearl */}
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.122, 0.132, 0.04, 32]} />
        <meshPhysicalMaterial color={ROSETTE} roughness={0.4} sheen={1} sheenColor="#ffd6e6" />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.122, 0.01, 10, 40]} />
        <meshPhysicalMaterial color={PEARL} roughness={0.2} clearcoat={1} />
      </mesh>
      {/* Satin peg and head */}
      <mesh castShadow receiveShadow>
        <latheGeometry args={[PEG, 40]} />
        <meshPhysicalMaterial color={pegColor} roughness={0.35} clearcoat={0.6} clearcoatRoughness={0.15} />
      </mesh>
      <mesh position={[0, HEAD_Y, 0]} castShadow>
        <sphereGeometry args={[0.052, 24, 18]} />
        <meshPhysicalMaterial color={pegColor} roughness={0.35} clearcoat={0.6} clearcoatRoughness={0.15} />
      </mesh>
      {/* The bow: two flattened loops meeting at a pearl knot */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * 0.042, BOW_Y, 0]}
          rotation={[0, 0, (side * Math.PI) / 2]}
          scale={[1, 1, 0.55]}
          castShadow
        >
          <coneGeometry args={[0.045, 0.08, 24]} />
          <meshPhysicalMaterial color={bowColor} roughness={0.3} clearcoat={0.7} clearcoatRoughness={0.15} />
        </mesh>
      ))}
      <mesh position={[0, BOW_Y, 0]} castShadow>
        <sphereGeometry args={[0.02, 16, 12]} />
        <meshPhysicalMaterial color={PEARL} roughness={0.15} clearcoat={1} />
      </mesh>
      {colorBlind && (
        <Billboard position={[0, 0.15, 0]}>
          <group position={[0, 0, 0.09]}>
            <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.055} />
          </group>
        </Billboard>
      )}
    </group>
  );
}
