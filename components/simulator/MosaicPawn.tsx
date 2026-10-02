"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";

export const MOSAIC_PAWN_HEIGHT = 0.41;

// The Mosaic board's cream glaze and gold lines (designs/board-mosaic.svg).
const CREAM = "#f3ebda";
const GOLD = "#c9a04a";

// The board's seat glazes: terracotta, teal, saffron, cobalt.
const PAWN_COLORS: Record<PlayerColor, string> = {
  red: "#c94f36",
  green: "#1a978d",
  yellow: "#eab03c",
  blue: "#3563c8",
  orange: "#d8691c",
  black: "#2e3442",
};

// Eight sides throughout, like the board's eight-point stars.
const SIDES = 8;

/** The board's eight-point star (#ia-star8): outer radius 1, flat on the table once laid. */
function starShape(radius: number) {
  const shape = new THREE.Shape();
  const inner = radius * 0.765;
  for (let i = 0; i < SIDES * 2; i++) {
    const angle = (i * Math.PI) / SIDES;
    const r = i % 2 === 0 ? radius : inner;
    const [x, y] = [Math.cos(angle) * r, Math.sin(angle) * r];
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/**
 * Stacked glazed tiles: two eight-sided tiers in the seat's glaze on a cream
 * plinth, an eight-point star collar between them, gold bands, and a
 * pointed cap with a gold bead, after the board's star tiles and arches.
 */
export function MosaicPawn({
  color,
  colorBlind = false,
}: {
  color: PlayerColor;
  /** The colour-blind palette, with the seat's symbol on the lower tier. */
  colorBlind?: boolean;
}) {
  const glaze = (colorBlind ? COLOR_BLIND_COLORS : PAWN_COLORS)[color];
  const deep = new THREE.Color(glaze).offsetHSL(0, 0, -0.1);
  const collar = useMemo(
    () => new THREE.ExtrudeGeometry(starShape(0.128), { depth: 0.016, bevelEnabled: false }),
    [],
  );
  const glazed = { roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, flatShading: true } as const;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
        <circleGeometry args={[0.16, 40]} />
        <meshBasicMaterial color="#0f1c3a" transparent opacity={0.24} depthWrite={false} />
      </mesh>
      {/* Cream plinth with a gold rim */}
      <mesh position={[0, 0.017, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.128, 0.14, 0.034, SIDES]} />
        <meshPhysicalMaterial color={CREAM} {...glazed} />
      </mesh>
      <mesh position={[0, 0.037, 0]} castShadow>
        <cylinderGeometry args={[0.122, 0.13, 0.008, SIDES]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.28} metalness={0.7} />
      </mesh>
      {/* Lower tier */}
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.098, 0.112, 0.078, SIDES]} />
        <meshPhysicalMaterial color={deep} {...glazed} />
      </mesh>
      {/* Eight-point star collar, laid flat */}
      <mesh geometry={collar} position={[0, 0.119, 0]} rotation={[-Math.PI / 2, 0, Math.PI / SIDES]} castShadow>
        <meshPhysicalMaterial color={CREAM} {...glazed} />
      </mesh>
      {/* Upper tier, banded in gold */}
      <mesh position={[0, 0.18, 0]} castShadow>
        <cylinderGeometry args={[0.068, 0.084, 0.09, SIDES]} />
        <meshPhysicalMaterial color={glaze} {...glazed} />
      </mesh>
      <mesh position={[0, 0.229, 0]} castShadow>
        <cylinderGeometry args={[0.076, 0.074, 0.01, SIDES]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.28} metalness={0.7} />
      </mesh>
      {/* Pointed cap and gold bead */}
      <mesh position={[0, 0.29, 0]} castShadow>
        <coneGeometry args={[0.074, 0.112, SIDES]} />
        <meshPhysicalMaterial color={glaze} {...glazed} />
      </mesh>
      <mesh position={[0, MOSAIC_PAWN_HEIGHT - 0.04, 0]} castShadow>
        <sphereGeometry args={[0.019, 16, 12]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.22} metalness={0.8} />
      </mesh>
      <mesh position={[0, MOSAIC_PAWN_HEIGHT - 0.012, 0]} castShadow>
        <coneGeometry args={[0.009, 0.03, 8]} />
        <meshPhysicalMaterial color={GOLD} roughness={0.22} metalness={0.8} />
      </mesh>
      {colorBlind && (
        // A medallion on the upper tier, turned to face the camera.
        <Billboard position={[0, 0.18, 0]}>
          <group position={[0, 0, 0.09]}>
            <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.058} />
          </group>
        </Billboard>
      )}
    </group>
  );
}
