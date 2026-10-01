"use client";

import * as THREE from "three";
import { Billboard } from "@react-three/drei";
import type { PlayerColor } from "@/lib/board/types";
import { COLOR_BLIND_COLORS, SEAT_SYMBOLS } from "@/lib/presentation/accessibility";
import { SeatSymbolMark } from "./SeatSymbolMark";
import { drawVeins } from "./roomParts";

/*
 * The earned piece styles (F3.5): turned wooden pawns stained in the seat
 * colour, and polished marble pawns cut from seat-coloured stone. Both are
 * lathe-turned figures the height of the classic peg, so they stand, stack
 * and highlight the way it does. The grain and veins are greyscale and
 * multiplied into the seat colour, which stays the piece's dominant colour.
 */

export const WOOD_PAWN_HEIGHT = 0.4;
export const MARBLE_PAWN_HEIGHT = 0.42;

// The classic peg's seat colours, so a style change never changes a colour.
const SEAT_COLORS: Record<PlayerColor, string> = {
  red: "#e2262e",
  green: "#31a65b",
  yellow: "#f2c400",
  blue: "#224c9e",
  orange: "#ef7d1a",
  black: "#3b3b46",
};

const profile = (points: [number, number][]) =>
  points.map(([radius, height]) => new THREE.Vector2(radius, height));

// A turned Ludo pawn: a flared foot, a bead, a slim waist, a collar and a
// round head, the way they come off a lathe.
const WOOD_PROFILE = profile([
  [0, 0],
  [0.165, 0],
  [0.172, 0.012],
  [0.168, 0.04],
  [0.14, 0.062],
  [0.118, 0.075],
  [0.128, 0.09],
  [0.118, 0.104],
  [0.085, 0.13],
  [0.066, 0.17],
  [0.06, 0.21],
  [0.07, 0.235],
  [0.098, 0.245],
  [0.1, 0.256],
  [0.074, 0.266],
  [0.09, 0.285],
  [0.104, 0.315],
  [0.102, 0.35],
  [0.086, 0.378],
  [0.05, 0.395],
  [0, WOOD_PAWN_HEIGHT],
]);

// A Staunton-style pawn: a stepped base, a tapering body, a wide collar
// and a ball, so marble reads differently from wood at a glance.
const MARBLE_PROFILE = profile([
  [0, 0],
  [0.172, 0],
  [0.176, 0.018],
  [0.164, 0.03],
  [0.15, 0.034],
  [0.152, 0.05],
  [0.13, 0.06],
  [0.118, 0.075],
  [0.1, 0.12],
  [0.078, 0.18],
  [0.066, 0.225],
  [0.112, 0.236],
  [0.116, 0.25],
  [0.07, 0.262],
  [0.088, 0.29],
  [0.11, 0.33],
  [0.108, 0.37],
  [0.088, 0.402],
  [0.05, 0.416],
  [0, MARBLE_PAWN_HEIGHT],
]);

// One greyscale texture per style, shared by every piece on the table.
let grain: THREE.CanvasTexture | null = null;
let veins: THREE.CanvasTexture | null = null;

function canvas(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the piece texture.");
  paint(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Turned grain: on a lathe the growth rings come out as bands running round
 * the piece, wavering a little. Light overall, so the stain stays bright.
 */
function woodGrain() {
  grain ??= canvas(64, 256, (ctx) => {
    let seed = 41;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 3 + random() * 7) {
      ctx.strokeStyle = `rgba(90,90,90,${0.12 + random() * 0.22})`;
      ctx.lineWidth = 0.8 + random() * 1.8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= 64; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.2 + y) * 1.4);
      ctx.stroke();
    }
  });
  return grain;
}

/** Light stone with darker veins, multiplied into the seat colour. */
function marbleVeins() {
  veins ??= canvas(256, 256, (ctx) => {
    ctx.fillStyle = "#f4f4f4";
    ctx.fillRect(0, 0, 256, 256);
    drawVeins(ctx, [0, 0, 256, 256], ["rgba(60,60,60,0.45)", "rgba(80,80,80,0.22)"], 211);
  });
  return veins;
}

function SymbolMedallion({ color, height }: { color: PlayerColor; height: number }) {
  return (
    // The round head has no flat face, so the medallion turns to face the
    // camera, just in front of the head.
    <Billboard position={[0, height - 0.07, 0]}>
      <group position={[0, 0, 0.108]}>
        <SeatSymbolMark symbol={SEAT_SYMBOLS[color]} radius={0.07} />
      </group>
    </Billboard>
  );
}

function ContactShadow() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
      <circleGeometry args={[0.17, 40]} />
      <meshBasicMaterial color="#11130f" transparent opacity={0.22} depthWrite={false} />
    </mesh>
  );
}

/** A turned wooden pawn, stained in the seat colour and oiled. */
export function WoodPawn({ color, colorBlind = false }: { color: PlayerColor; colorBlind?: boolean }) {
  const stain = (colorBlind ? COLOR_BLIND_COLORS : SEAT_COLORS)[color];
  return (
    <group>
      <ContactShadow />
      <mesh castShadow receiveShadow>
        <latheGeometry args={[WOOD_PROFILE, 48]} />
        <meshPhysicalMaterial
          color={stain}
          map={woodGrain()}
          // Oiled, not lacquered: a soft sheen that leaves the stain saturated.
          roughness={0.55}
          clearcoat={0.15}
          clearcoatRoughness={0.45}
        />
      </mesh>
      {colorBlind && <SymbolMedallion color={color} height={WOOD_PAWN_HEIGHT} />}
    </group>
  );
}

/** A polished marble pawn cut from seat-coloured stone. */
export function MarblePawn({ color, colorBlind = false }: { color: PlayerColor; colorBlind?: boolean }) {
  const stone = (colorBlind ? COLOR_BLIND_COLORS : SEAT_COLORS)[color];
  return (
    <group>
      <ContactShadow />
      <mesh castShadow receiveShadow>
        <latheGeometry args={[MARBLE_PROFILE, 56]} />
        <meshPhysicalMaterial
          color={stone}
          map={marbleVeins()}
          roughness={0.2}
          clearcoat={0.7}
          clearcoatRoughness={0.06}
          envMapIntensity={0.9}
        />
      </mesh>
      {colorBlind && <SymbolMedallion color={color} height={MARBLE_PAWN_HEIGHT} />}
    </group>
  );
}
