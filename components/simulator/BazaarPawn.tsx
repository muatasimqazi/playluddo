"use client";

import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";

export const BAZAAR_PAWN_HEIGHT = 0.42;

// The board's brass (designs/board-bazaar.svg, #bz-brass), kept to the
// trim so the seat's colour is most of the piece.
const BRASS = "#d9a845";
// Yellow glass beside brass would read as all brass, so the yellow
// lantern's trim is darker bronze instead.
const BRONZE = "#7a5218";

// The board's jewel tones: pomegranate, emerald, saffron, indigo. The
// saffron leans lemon so it stays clear of the brass.
const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#c23a30",
  green: "#23885a",
  yellow: "#ffcf1f",
  blue: "#2f56b0",
  orange: "#d8691c",
  black: "#3a3440",
};

// The lantern's eight-sided glass, matching the board's eight-point stars.
const SIDES = 8;
const GLASS_BOTTOM = 0.072;
const GLASS_TOP = 0.108;
const GLASS_HEIGHT = 0.15;
const GLASS_Y = 0.15;
// Each rib leans out with the glass, from its bottom corner to its top one.
const RIB_LEAN = Math.atan((GLASS_TOP - GLASS_BOTTOM) / GLASS_HEIGHT);

/**
 * A lantern like the one lit at the Bazaar board's centre: a glass body in
 * the seat's colour that glows faintly, under a glazed dome of the same
 * colour, with brass at the foot, bands, corner ribs, finial and hanging ring.
 */
export function BazaarPawn({
  color,
  colorBlind = false,
}: {
  color: PlayerColor;
  /** The colour-blind palette, with the seat's symbol on the glass. */
  colorBlind?: boolean;
}) {
  const pawnColor = (colorBlind ? COLOR_BLIND_COLORS : PAWN_COLORS)[color];
  const glow = new THREE.Color(pawnColor).offsetHSL(0, 0.05, 0.08);
  const dark = new THREE.Color(pawnColor).offsetHSL(0, 0, -0.16);
  const trim = color === "yellow" ? BRONZE : BRASS;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.165, 40]} />
        <meshBasicMaterial color="#1e120b" transparent opacity={0.24} depthWrite={false} />
      </mesh>
      {/* Brass foot ring, and a glazed stem */}
      <mesh position={[0, 0.012, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.142, 0.024, SIDES * 4]} />
        <meshPhysicalMaterial color={trim} roughness={0.32} metalness={0.7} clearcoat={0.5} />
      </mesh>
      <mesh position={[0, 0.048, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.115, 0.05, SIDES]} />
        <meshPhysicalMaterial color={dark} roughness={0.24} clearcoat={0.8} clearcoatRoughness={0.1} flatShading />
      </mesh>
      {/* Bottom band */}
      <mesh position={[0, GLASS_Y - GLASS_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[GLASS_BOTTOM + 0.012, GLASS_BOTTOM + 0.006, 0.02, SIDES]} />
        <meshPhysicalMaterial color={trim} roughness={0.28} metalness={0.75} />
      </mesh>
      {/* Glass, lit from within */}
      <mesh position={[0, GLASS_Y, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[GLASS_TOP, GLASS_BOTTOM, GLASS_HEIGHT, SIDES]} />
        <meshPhysicalMaterial
          color={pawnColor}
          emissive={glow}
          emissiveIntensity={0.32}
          roughness={0.16}
          clearcoat={1}
          clearcoatRoughness={0.06}
          flatShading
        />
      </mesh>
      {/* Brass ribs on the glass's corners */}
      {Array.from({ length: SIDES }, (_, i) => (
        <group key={i} rotation={[0, (i * Math.PI * 2) / SIDES, 0]}>
          <mesh
            position={[0, GLASS_Y, (GLASS_TOP + GLASS_BOTTOM) / 2 + 0.002]}
            rotation={[RIB_LEAN, 0, 0]}
            castShadow
          >
            <boxGeometry args={[0.013, GLASS_HEIGHT + 0.006, 0.013]} />
            <meshPhysicalMaterial color={trim} roughness={0.3} metalness={0.75} />
          </mesh>
        </group>
      ))}
      {/* Top band */}
      <mesh position={[0, GLASS_Y + GLASS_HEIGHT / 2 + 0.008, 0]} castShadow>
        <cylinderGeometry args={[GLASS_TOP + 0.016, GLASS_TOP + 0.01, 0.024, SIDES]} />
        <meshPhysicalMaterial color={trim} roughness={0.28} metalness={0.75} clearcoat={0.4} />
      </mesh>
      {/* Glazed dome */}
      <mesh position={[0, 0.244, 0]} castShadow>
        <sphereGeometry args={[0.112, SIDES * 3, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color={pawnColor} roughness={0.18} clearcoat={0.9} clearcoatRoughness={0.08} />
      </mesh>
      {/* Finial and hanging ring */}
      <mesh position={[0, 0.364, 0]} castShadow>
        <sphereGeometry args={[0.022, 16, 12]} />
        <meshPhysicalMaterial color={trim} roughness={0.22} metalness={0.8} />
      </mesh>
      <mesh position={[0, BAZAAR_PAWN_HEIGHT - 0.026, 0]} castShadow>
        <torusGeometry args={[0.026, 0.007, 10, 24]} />
        <meshPhysicalMaterial color={trim} roughness={0.22} metalness={0.8} />
      </mesh>
      {colorBlind && (
        // A medallion on the glass, turned to face the camera.
        <Billboard position={[0, GLASS_Y, 0]}>
          <group position={[0, 0, 0.11]}>
            <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.06} />
          </group>
        </Billboard>
      )}
    </group>
  );
}
