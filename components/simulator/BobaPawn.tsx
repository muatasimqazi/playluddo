"use client";

import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";

export const BOBA_PAWN_HEIGHT = 0.43;

// The Boba board's cream, milk-tea brown, tapioca and straw pink
// (designs/board-boba.svg).
const CREAM = "#fff6ea";
const MILK_TEA = "#7a4e32";
const TAPIOCA = "#3a2418";
const STRAW = "#f06292";
const BLUSH = "#ff8fb1";

// The board's flavours: strawberry, matcha, mango, taro (and the hexagon's
// Thai tea and brown sugar).
const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#ee7799",
  green: "#78b062",
  yellow: "#f4b942",
  blue: "#9b7bc8",
  orange: "#dd6a2c",
  black: "#5a3a28",
};

const CUP_BOTTOM = 0.03;
const CUP_HEIGHT = 0.22;
const CUP_TOP_RADIUS = 0.088;
const CUP_BOTTOM_RADIUS = 0.072;
const CUP_TOP = CUP_BOTTOM + CUP_HEIGHT;
const FACE_Y = 0.17;

/** The cup's radius at height `y`. */
const cupRadius = (y: number) =>
  CUP_BOTTOM_RADIUS + ((CUP_TOP_RADIUS - CUP_BOTTOM_RADIUS) * (y - CUP_BOTTOM)) / CUP_HEIGHT;

// Two rows of pearls showing through the cup's foot.
const PEARLS = [
  ...Array.from({ length: 10 }, (_, i) => ({ y: 0.056, angle: (i / 10) * Math.PI * 2 })),
  ...Array.from({ length: 9 }, (_, i) => ({ y: 0.088, angle: ((i + 0.5) / 9) * Math.PI * 2 })),
];

/**
 * A cup of bubble tea for the boba board: the drink in the seat's flavour on
 * a cream coaster, tapioca pearls at the bottom, a domed lid, a pink straw,
 * and a little face that turns to the camera.
 */
export function BobaPawn({
  color,
  colorBlind = false,
}: {
  color: PlayerColor;
  /** The colour-blind palette, with the seat's symbol in place of the face. */
  colorBlind?: boolean;
}) {
  const drinkColor = (colorBlind ? COLOR_BLIND_COLORS : PAWN_COLORS)[color];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.16, 40]} />
        <meshBasicMaterial color="#3a2418" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {/* Cream coaster, ringed in milk tea */}
      <mesh position={[0, 0.015, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.12, 0.13, 0.03, 32]} />
        <meshPhysicalMaterial color={CREAM} roughness={0.5} clearcoat={0.3} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.122, 0.007, 10, 40]} />
        <meshStandardMaterial color={MILK_TEA} roughness={0.6} />
      </mesh>
      {/* The drink, with its pearls at the foot */}
      <mesh position={[0, CUP_BOTTOM + CUP_HEIGHT / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[CUP_TOP_RADIUS, CUP_BOTTOM_RADIUS, CUP_HEIGHT, 32]} />
        <meshPhysicalMaterial color={drinkColor} roughness={0.15} clearcoat={1} clearcoatRoughness={0.08} />
      </mesh>
      {PEARLS.map(({ y, angle }, i) => {
        const r = cupRadius(y) - 0.006;
        return (
          <mesh key={i} position={[Math.sin(angle) * r, y, Math.cos(angle) * r]}>
            <sphereGeometry args={[0.016, 12, 10]} />
            <meshPhysicalMaterial color={TAPIOCA} roughness={0.15} clearcoat={1} />
          </mesh>
        );
      })}
      {/* Lid rim, domed lid and straw */}
      <mesh position={[0, CUP_TOP, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[CUP_TOP_RADIUS, 0.009, 10, 40]} />
        <meshPhysicalMaterial color="#ffffff" roughness={0.3} clearcoat={0.6} />
      </mesh>
      <mesh position={[0, CUP_TOP, 0]} castShadow>
        <sphereGeometry args={[CUP_TOP_RADIUS, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color="#ffffff" roughness={0.1} clearcoat={1} transparent opacity={0.8} />
      </mesh>
      <mesh position={[0.025, 0.335, 0]} rotation={[0, 0, -0.2]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.2, 16]} />
        <meshPhysicalMaterial color={STRAW} roughness={0.25} clearcoat={0.8} />
      </mesh>
      {/* Eyes, smile and blush, or the seat's symbol in colour-blind mode. It
          only turns about the upright, so it stays on the cup's front rather
          than tipping back into it under a high camera. */}
      <Billboard position={[0, FACE_Y, 0]} lockX lockZ>
        <group position={[0, 0, cupRadius(FACE_Y) + 0.004]}>
          {colorBlind ? (
            <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.05} />
          ) : (
            <>
              {[-1, 1].map((side) => (
                <group key={side}>
                  <mesh position={[side * 0.026, 0.012, 0]}>
                    <sphereGeometry args={[0.01, 12, 10]} />
                    <meshBasicMaterial color={TAPIOCA} />
                  </mesh>
                  <mesh position={[side * 0.044, -0.008, 0]}>
                    <circleGeometry args={[0.011, 16]} />
                    <meshBasicMaterial color={BLUSH} transparent opacity={0.8} />
                  </mesh>
                </group>
              ))}
              <mesh position={[0, 0.002, 0]} rotation={[0, 0, Math.PI]}>
                <torusGeometry args={[0.01, 0.0028, 6, 16, Math.PI]} />
                <meshBasicMaterial color={TAPIOCA} />
              </mesh>
            </>
          )}
        </group>
      </Billboard>
    </group>
  );
}
