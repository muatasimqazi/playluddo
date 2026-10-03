"use client";

import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";

export const GLAM_PAWN_HEIGHT = 0.4;

// The Pink Glam board's compact white, blush and mirror-bulb gold
// (designs/board-glam.svg).
const COMPACT = "#fff7fb";
const BLUSH = "#f6a9cc";
const GOLD = "#e8c25a";

// The board's yards: hot pink, aqua, sunshine, lavender (and the hexagon's
// coral and plum).
const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#e6268c",
  green: "#23b5c9",
  yellow: "#f7b928",
  blue: "#9a62d3",
  orange: "#ff7a45",
  black: "#4a2e4f",
};

// The board's heart (gl-heart), point down, about 0.12 across and centred.
const HEART_SCALE = 0.0013;
const HEART = (() => {
  const p = (x: number, y: number) => [x * HEART_SCALE, -(y + 7) * HEART_SCALE] as const;
  const shape = new THREE.Shape();
  shape.moveTo(...p(0, 30));
  shape.bezierCurveTo(...p(-40, 5), ...p(-50, -20), ...p(-32, -34));
  shape.bezierCurveTo(...p(-18, -44), ...p(-4, -36), ...p(0, -24));
  shape.bezierCurveTo(...p(4, -36), ...p(18, -44), ...p(32, -34));
  shape.bezierCurveTo(...p(50, -20), ...p(40, 5), ...p(0, 30));
  return shape;
})();
const HEART_DEPTH = 0.022;
const HEART_EXTRUDE = {
  depth: HEART_DEPTH,
  bevelEnabled: true,
  bevelThickness: 0.008,
  bevelSize: 0.006,
  bevelSegments: 3,
  curveSegments: 16,
};

const BODY_HEIGHT = 0.17;
const BODY_Y = 0.04 + BODY_HEIGHT / 2;

/**
 * A perfume bottle for the vanity-table board: a faceted bottle in the
 * seat's colour on a white compact ringed in blush, a gold collar, and a
 * heart stopper that turns to face the camera.
 */
export function GlamPawn({
  color,
  colorBlind = false,
}: {
  color: PlayerColor;
  /** The colour-blind palette, with the seat's symbol on the bottle. */
  colorBlind?: boolean;
}) {
  const bottleColor = (colorBlind ? COLOR_BLIND_COLORS : PAWN_COLORS)[color];
  const shoulderColor = new THREE.Color(bottleColor).offsetHSL(0, 0, -0.08);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.16, 40]} />
        <meshBasicMaterial color="#5a1838" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {/* Compact base, ringed in blush */}
      <mesh position={[0, 0.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.125, 0.135, 0.04, 32]} />
        <meshPhysicalMaterial color={COMPACT} roughness={0.25} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.118, 0.008, 10, 40]} />
        <meshPhysicalMaterial color={BLUSH} roughness={0.3} clearcoat={0.6} />
      </mesh>
      {/* Faceted bottle and its shoulder */}
      <mesh position={[0, BODY_Y, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.088, 0.1, BODY_HEIGHT, 8]} />
        <meshPhysicalMaterial color={bottleColor} roughness={0.08} clearcoat={1} clearcoatRoughness={0.05} flatShading />
      </mesh>
      <mesh position={[0, 0.04 + BODY_HEIGHT + 0.0175, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.088, 0.035, 8]} />
        <meshPhysicalMaterial color={shoulderColor} roughness={0.08} clearcoat={1} flatShading />
      </mesh>
      {/* Gold collar */}
      <mesh position={[0, 0.262, 0]} castShadow>
        <cylinderGeometry args={[0.034, 0.038, 0.03, 24]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.25} metalness={0.8} />
      </mesh>
      {/* Heart stopper, facing the camera */}
      <Billboard position={[0, 0.328, 0]}>
        <mesh position={[0, 0, -HEART_DEPTH / 2]} castShadow>
          <extrudeGeometry args={[HEART, HEART_EXTRUDE]} />
          <meshPhysicalMaterial color={bottleColor} roughness={0.1} clearcoat={1} />
        </mesh>
      </Billboard>
      {colorBlind && (
        <Billboard position={[0, BODY_Y, 0]}>
          <group position={[0, 0, 0.1]}>
            <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.058} />
          </group>
        </Billboard>
      )}
    </group>
  );
}
