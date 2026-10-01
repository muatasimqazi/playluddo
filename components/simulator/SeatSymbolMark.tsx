"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { symbolOutline, type SeatSymbol } from "@/lib/presentation/accessibility";

const PAPER = "#fdfbf7";
const INK = "#1d1d22";

// One geometry per symbol, shared by every pawn and base that shows it.
const geometries = new Map<SeatSymbol, THREE.ShapeGeometry>();
function symbolGeometry(symbol: SeatSymbol) {
  let geometry = geometries.get(symbol);
  if (!geometry) {
    const shape = new THREE.Shape(
      symbolOutline(symbol).map(([x, y]) => new THREE.Vector2(x, y)),
    );
    geometry = new THREE.ShapeGeometry(shape);
    geometries.set(symbol, geometry);
  }
  return geometry;
}

/**
 * A seat's symbol (F5.5) as a small medallion: a dark symbol on a pale disc,
 * which reads on every seat colour in either palette. Drawn in its own XY
 * plane, facing +z; callers lay it flat or turn it toward the camera.
 */
export function SeatSymbolMark({
  symbol,
  radius,
}: {
  symbol: SeatSymbol;
  /** The disc's radius, in world units. */
  radius: number;
}) {
  const geometry = useMemo(() => symbolGeometry(symbol), [symbol]);
  return (
    <group>
      <mesh renderOrder={3}>
        <circleGeometry args={[radius, 32]} />
        <meshBasicMaterial color={PAPER} toneMapped={false} />
      </mesh>
      <mesh
        geometry={geometry}
        position={[0, 0, 0.0015]}
        scale={radius * 0.68}
        renderOrder={4}
      >
        <meshBasicMaterial color={INK} toneMapped={false} />
      </mesh>
    </group>
  );
}
