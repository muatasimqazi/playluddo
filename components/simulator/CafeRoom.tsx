"use client";

import { useEffect, useMemo } from "react";
import { RoundedBox, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Point, Quality } from "@/lib/presentation/board";
import {
  Box,
  BoxInstances,
  canvasTexture,
  drawVeins,
  grain,
  makeOcclusionTextures,
  Occlusion,
  seeded,
} from "./roomParts";

/*
 * A corner café on a city street: checkerboard marble floor, subway tile
 * and green paint, a brick wall with a neon sign, a pressed-tin ceiling, and
 * the coffee bar along the back. The same footprint, seat positions and
 * table height as the Apartment, so cameras, seat figures and the board all
 * land as they do there. Every surface but the oak tabletop is drawn here.
 */

const FLOOR_Y = -2.6;
const CEILING_Y = 14.525;

const PAINT = "#34503f";
const TILE_GREEN = "#5e8c72";
const OAK = "#e6c49c";
const DARK_WOOD = "#5a3f2c";
const IRON = "#1d1e1d";
const BRASS = "#b48a4e";
const VELVET = "#2f5d4a";
const BENTWOOD = "#3a2416";

/** A texture's own copy, repeated `x` by `y` times across a face. */
function tiled(source: THREE.Texture, x: number, y: number) {
  const t = source.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(x, y);
  return t;
}

/**
 * Draws a layout twice: once in colour, once as a height map where joints
 * (grout, mortar) are low — so tile and brick catch the light at their edges.
 */
function colourAndBump(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, bump: boolean) => void,
) {
  const map = canvasTexture(width, height, (ctx) => paint(ctx, false));
  const bump = canvasTexture(width, height, (ctx) => paint(ctx, true), false);
  map.wrapS = map.wrapT = bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

/** Two white and two black marble tiles: one repeat is 1.6 x 1.6 units. */
function makeCheckerFloor() {
  const t = canvasTexture(512, 512, (ctx) => {
    for (const [x, y, dark] of [
      [0, 0, false],
      [256, 0, true],
      [0, 256, true],
      [256, 256, false],
    ] as const) {
      ctx.fillStyle = dark ? "#1d1c1b" : "#ebe6dc";
      ctx.fillRect(x, y, 256, 256);
      drawVeins(
        ctx,
        [x, y, 256, 256],
        dark
          ? ["rgba(225,220,210,0.16)", "rgba(225,220,210,0.08)"]
          : ["rgba(110,104,98,0.2)", "rgba(120,112,104,0.12)"],
        x * 3 + y * 7 + 5,
      );
    }
    ctx.fillStyle = "#8c8780";
    for (const v of [0, 256, 512]) {
      ctx.fillRect(v - 2, 0, 4, 512);
      ctx.fillRect(0, v - 2, 512, 4);
    }
    grain(ctx, 512, 512, 8, 13);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Glazed subway tile, half-bond: one repeat is 3.2 x 3.2 units (4 x 8 tiles). */
function makeSubway() {
  return colourAndBump(256, 256, (ctx, bump) => {
    const random = seeded(19);
    ctx.fillStyle = bump ? "#000" : "#cfcac0";
    ctx.fillRect(0, 0, 256, 256);
    if (bump) ctx.filter = "blur(1.5px)";
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 5; col++) {
        const x = col * 64 + (row % 2 ? 32 : 0) + 2;
        const y = row * 32 + 2;
        if (bump) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(x + 1, y + 1, 58, 26);
          continue;
        }
        const shade = 242 + Math.round((random() - 0.5) * 8);
        const g = ctx.createLinearGradient(0, y, 0, y + 28);
        g.addColorStop(0, `rgb(${shade + 6},${shade + 5},${shade + 2})`);
        g.addColorStop(1, `rgb(${shade - 10},${shade - 11},${shade - 14})`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, 60, 28);
      }
    }
  });
}

/** Running-bond brick: one repeat is 4.8 x 1.6 units (four courses). */
function makeBrick() {
  const colours = [
    "#8e4a35",
    "#9c5638",
    "#7e3f2e",
    "#a8614a",
    "#86503c",
    "#93533f",
  ];
  return colourAndBump(512, 256, (ctx, bump) => {
    const random = seeded(29);
    ctx.fillStyle = bump ? "#000" : "#b9b0a2";
    ctx.fillRect(0, 0, 512, 256);
    if (bump) ctx.filter = "blur(2px)";
    for (let row = 0; row < 4; row++) {
      for (let col = -1; col < 5; col++) {
        const x = col * 128 + (row % 2 ? 64 : 0) + 4;
        const y = row * 64 + 4;
        if (bump) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(x + 2, y + 2, 116, 52);
          continue;
        }
        ctx.fillStyle = colours[Math.floor(random() * colours.length)];
        ctx.fillRect(x, y, 120, 56);
        // Fired-clay variation: a darker scorch on some, a pale bloom on others.
        const g = ctx.createRadialGradient(
          x + random() * 120,
          y + random() * 56,
          2,
          x + 60,
          y + 28,
          90,
        );
        g.addColorStop(
          0,
          random() > 0.5 ? "rgba(40,20,12,0.28)" : "rgba(235,200,170,0.18)",
        );
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, 120, 56);
      }
    }
    if (!bump) grain(ctx, 512, 256, 30, 31);
  });
}

/** Pressed-tin ceiling relief (height map only): one tile is 1.8 units. */
function makeTin() {
  const t = canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, 256, 256);
      ctx.filter = "blur(2px)";
      ctx.strokeStyle = "#e0e0e0";
      ctx.lineWidth = 10;
      ctx.strokeRect(16, 16, 224, 224);
      ctx.strokeStyle = "#404040";
      ctx.lineWidth = 6;
      ctx.strokeRect(30, 30, 196, 196);
      ctx.strokeStyle = "#d8d8d8";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(128, 128, 70, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.fillStyle = "#c8c8c8";
        ctx.beginPath();
        ctx.ellipse(
          128 + Math.cos(a) * 40,
          128 + Math.sin(a) * 40,
          16,
          8,
          a,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.fillStyle = "#f0f0f0";
      ctx.beginPath();
      ctx.arc(128, 128, 16, 0, Math.PI * 2);
      ctx.fill();
      for (const [x, y] of [
        [0, 0],
        [256, 0],
        [0, 256],
        [256, 256],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    false,
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const CHALK_FONT =
  '"Chalkduster", "Marker Felt", "Bradley Hand", "Comic Sans MS", cursive';

/** A chalkboard menu: a heading, then items with prices, in chalk. */
function makeChalkboard(
  title: string,
  items: [string, string][],
  seed: number,
) {
  return canvasTexture(512, 360, (ctx) => {
    const random = seeded(seed);
    ctx.fillStyle = "#262b28";
    ctx.fillRect(0, 0, 512, 360);
    // Old erased chalk.
    for (let i = 0; i < 14; i++) {
      const x = random() * 512,
        y = random() * 360,
        r = 30 + random() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.06)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.fillStyle = "rgba(245,242,232,0.92)";
    ctx.textBaseline = "alphabetic";
    ctx.font = `44px ${CHALK_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(title, 256, 62);
    ctx.fillRect(160, 78, 192, 2);
    ctx.font = `25px ${CHALK_FONT}`;
    items.forEach(([name, price], i) => {
      const y = 124 + i * 40;
      ctx.textAlign = "left";
      ctx.fillText(name, 44, y);
      ctx.textAlign = "right";
      ctx.fillText(price, 468, y);
    });
    // Chalk is never solid.
    const pixels = ctx.getImageData(0, 0, 512, 360);
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i] > 120 && random() > 0.72) {
        pixels.data[i] *= 0.6;
        pixels.data[i + 1] *= 0.6;
        pixels.data[i + 2] *= 0.6;
      }
    }
    ctx.putImageData(pixels, 0, 0);
  });
}

/**
 * The street outside, through the shop window: a row of facades across the
 * road with shopfronts and awnings, the sidewalk and kerb, a few street
 * trees — softened, as glass and distance soften it.
 */
function makeStreet() {
  const W = 1536,
    H = 768;
  return canvasTexture(W, H, (ctx) => {
    const random = seeded(53);
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.4);
    sky.addColorStop(0, "#a9c6df");
    sky.addColorStop(1, "#e4ecf0");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const facades = [
      "#d9cbb0",
      "#c8b79c",
      "#a9654c",
      "#e0d6c4",
      "#b9a58a",
      "#8f8a84",
      "#c99a7c",
    ];
    const awnings = [
      ["#9b2d2a", "#efe6d6"],
      ["#2f5d4a", "#efe6d6"],
      ["#1f2a3d", "#e9dfc8"],
    ];
    for (let x = -20; x < W;) {
      const w = 170 + random() * 160;
      const top = H * (0.04 + random() * 0.2);
      ctx.fillStyle = facades[Math.floor(random() * facades.length)];
      ctx.fillRect(x, top, w, H * 0.78 - top);
      // Cornice.
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(x - 4, top, w + 8, 10);
      // Upper-floor windows.
      for (let y = top + 34; y < H * 0.55; y += 72) {
        for (let wx = x + 22; wx < x + w - 40; wx += 52) {
          ctx.fillStyle = "#3d4a55";
          ctx.fillRect(wx, y, 30, 46);
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fillRect(wx, y, 30, 4);
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.fillRect(wx - 3, y + 46, 36, 4);
        }
      }
      // Shopfront and its awning.
      ctx.fillStyle = "#2a2f33";
      ctx.fillRect(x + 14, H * 0.62, w - 28, H * 0.16);
      ctx.fillStyle = "rgba(255,230,190,0.25)";
      ctx.fillRect(x + 20, H * 0.64, w - 40, H * 0.12);
      const [a, b] = awnings[Math.floor(random() * awnings.length)];
      for (let sx = x + 6; sx < x + w - 6; sx += 18) {
        ctx.fillStyle = (sx - x) % 36 < 18 ? a : b;
        ctx.beginPath();
        ctx.moveTo(sx, H * 0.58);
        ctx.lineTo(sx + 18, H * 0.58);
        ctx.lineTo(sx + 22, H * 0.635);
        ctx.lineTo(sx + 4, H * 0.635);
        ctx.fill();
      }
      x += w;
    }
    ctx.fillStyle = "#b8b3aa";
    ctx.fillRect(0, H * 0.78, W, H * 0.08);
    ctx.fillStyle = "#8d8a84";
    ctx.fillRect(0, H * 0.86, W, 6);
    ctx.fillStyle = "#55575a";
    ctx.fillRect(0, H * 0.86 + 6, W, H);
    ctx.fillStyle = "#d9d6cc";
    for (let x = 0; x < W; x += 120) ctx.fillRect(x, H * 0.95, 60, 5);
    // Street trees on the far sidewalk.
    for (let x = 90; x < W; x += 300 + random() * 120) {
      ctx.fillStyle = "#4a3a2c";
      ctx.fillRect(x - 5, H * 0.56, 10, H * 0.24);
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = i % 2 ? "#5d7a3e" : "#4c6a34";
        ctx.beginPath();
        ctx.arc(
          x + (random() - 0.5) * 90,
          H * (0.45 + random() * 0.12),
          28 + random() * 26,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    // Soften the whole view, as the glass and the distance do.
    const copy = document.createElement("canvas");
    copy.width = W;
    copy.height = H;
    copy.getContext("2d")?.drawImage(ctx.canvas, 0, 0);
    ctx.filter = "blur(1.6px)";
    ctx.drawImage(copy, 0, 0);
    ctx.filter = "none";
  });
}

/** Gilded shop-window lettering, painted for the street: mirrored from inside. */
function makeLettering() {
  return canvasTexture(1024, 300, (ctx) => {
    ctx.translate(1024, 0);
    ctx.scale(-1, 1);
    const gold = ctx.createLinearGradient(0, 40, 0, 200);
    gold.addColorStop(0, "#f6dc93");
    gold.addColorStop(0.5, "#c8953e");
    gold.addColorStop(1, "#f1d084");
    ctx.textAlign = "center";
    ctx.font = 'italic 600 128px "Didot", "Bodoni 72", Georgia, serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#4a3210";
    ctx.strokeText("Luddo Café", 512, 170);
    ctx.fillStyle = gold;
    ctx.fillText("Luddo Café", 512, 170);
    ctx.font = '500 34px "Didot", Georgia, serif';
    ctx.letterSpacing = "10px";
    ctx.fillStyle = "#d9b265";
    ctx.fillText("COFFEE · PASTRIES · GAMES", 512, 252);
  });
}

/** A pink neon "coffee", glowing; transparent everywhere but the tube. */
function makeNeon() {
  return canvasTexture(640, 240, (ctx) => {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font =
      'italic 700 150px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive';
    ctx.lineJoin = "round";
    for (const [blur, width, colour] of [
      [36, 14, "rgba(255,90,150,0.55)"],
      [14, 9, "rgba(255,140,180,0.9)"],
      [0, 4, "#fff0f5"],
    ] as const) {
      ctx.shadowBlur = blur;
      ctx.shadowColor = "rgba(255,80,140,1)";
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.strokeText("coffee", 320, 120);
    }
  });
}

/** A screen-printed café poster. */
function makePoster(kind: "espresso" | "beans") {
  return canvasTexture(300, 400, (ctx) => {
    ctx.fillStyle = kind === "espresso" ? "#efe4cf" : "#2f5d4a";
    ctx.fillRect(0, 0, 300, 400);
    if (kind === "espresso") {
      ctx.fillStyle = "#c9b28c";
      ctx.beginPath();
      ctx.arc(150, 170, 104, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f6f1e6";
      ctx.beginPath();
      ctx.arc(150, 170, 86, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6b3e22";
      ctx.beginPath();
      ctx.arc(150, 170, 66, 0, Math.PI * 2);
      ctx.fill();
      // Latte-art heart.
      ctx.fillStyle = "#e9d6b5";
      ctx.beginPath();
      ctx.moveTo(150, 205);
      ctx.bezierCurveTo(100, 170, 118, 130, 150, 152);
      ctx.bezierCurveTo(182, 130, 200, 170, 150, 205);
      ctx.fill();
      ctx.fillStyle = "#3b2a1e";
      ctx.font = '700 34px "Futura", "Avenir Next", Helvetica, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("ESPRESSO", 150, 338);
      ctx.font = '400 15px "Futura", Helvetica, sans-serif';
      ctx.fillText("ROASTED IN HOUSE", 150, 364);
    } else {
      ctx.fillStyle = "#e9c46a";
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.translate(90 + (i % 2) * 120, 90 + i * 48);
        ctx.rotate(0.6 - i * 0.3);
        ctx.beginPath();
        ctx.ellipse(0, 0, 34, 22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#2f5d4a";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-26, 0);
        ctx.quadraticCurveTo(0, -8, 26, 0);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = "#efe4cf";
      ctx.font = '700 30px "Futura", "Avenir Next", Helvetica, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("SINGLE ORIGIN", 150, 360);
    }
    grain(ctx, 300, 400, 14, kind === "espresso" ? 61 : 67);
  });
}

/** Woven cane for the bentwood seats. */
function makeCane() {
  const t = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = "#6e5232";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "#d8b47a";
    ctx.lineWidth = 3;
    for (const angle of [0, Math.PI / 3, -Math.PI / 3]) {
      ctx.save();
      ctx.translate(32, 32);
      ctx.rotate(angle);
      for (let v = -64; v <= 64; v += 10) {
        ctx.beginPath();
        ctx.moveTo(-64, v);
        ctx.lineTo(64, v);
        ctx.stroke();
      }
      ctx.restore();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

function Bentwood() {
  return (
    <meshPhysicalMaterial
      color={BENTWOOD}
      roughness={0.45}
      clearcoat={0.5}
      clearcoatRoughness={0.3}
    />
  );
}

/** A Thonet No. 14 café chair: bentwood hoops, cane seat. Faces -z. */
function ThonetChair({
  position,
  rotation,
  cane,
}: {
  position: Point;
  rotation: number;
  cane: THREE.Texture;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 1.42, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.7, 0.7, 0.06, 32]} />
        <meshStandardMaterial map={cane} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.42, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.72, 0.07, 10, 40]} />
        <Bentwood />
      </mesh>
      {[
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.48, 0.5],
        [0.48, 0.5],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.71, z]} castShadow>
          <cylinderGeometry args={[0.05, 0.04, 1.42, 10]} />
          <Bentwood />
        </mesh>
      ))}
      <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.52, 0.03, 8, 40]} />
        <Bentwood />
      </mesh>
      {/* The back: two posts carried up into one bent hoop, a small loop inside. */}
      {[-0.45, 0.45].map((x) => (
        <mesh
          key={x}
          position={[x, 2.37, 0.595]}
          rotation={[0.1, 0, 0]}
          castShadow
        >
          <cylinderGeometry args={[0.05, 0.05, 1.9, 10]} />
          <Bentwood />
        </mesh>
      ))}
      <mesh position={[0, 3.3, 0.69]} rotation={[0.1, 0, 0]} castShadow>
        <torusGeometry args={[0.45, 0.055, 10, 32, Math.PI]} />
        <Bentwood />
      </mesh>
      <mesh
        position={[0, 2.45, 0.6]}
        rotation={[0.1, 0, 0]}
        scale={[1, 1.45, 1]}
      >
        <torusGeometry args={[0.24, 0.035, 8, 32]} />
        <Bentwood />
      </mesh>
    </group>
  );
}

/** A green velvet banquette with a channel-tufted back, on the north seat. */
function Banquette({ wood }: { wood: THREE.Texture }) {
  const channels = 12;
  const width = 9.2;
  return (
    <group position={[0, FLOOR_Y, -6.3]}>
      <Box
        position={[0, 0.45, 0]}
        size={[9.4, 0.9, 2.6]}
        color={DARK_WOOD}
        map={wood}
        roughness={0.5}
      />
      <RoundedBox
        args={[9.2, 0.45, 2.25]}
        radius={0.16}
        smoothness={4}
        position={[0, 1.12, 0.12]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={VELVET}
          roughness={1}
          sheen={1}
          sheenRoughness={0.35}
          sheenColor="#8fc4a8"
        />
      </RoundedBox>
      {Array.from({ length: channels }, (_, i) => (
        <RoundedBox
          key={i}
          args={[width / channels - 0.03, 2.0, 0.45]}
          radius={0.2}
          smoothness={4}
          position={[-width / 2 + (width / channels) * (i + 0.5), 2.35, -1.0]}
          castShadow
          receiveShadow
        >
          <meshPhysicalMaterial
            color={VELVET}
            roughness={1}
            sheen={1}
            sheenRoughness={0.35}
            sheenColor="#8fc4a8"
          />
        </RoundedBox>
      ))}
      <Box
        position={[0, 2.32, -1.28]}
        size={[9.4, 2.2, 0.1]}
        color={DARK_WOOD}
        map={wood}
      />
      <Box
        position={[0, 3.42, -1.15]}
        size={[9.4, 0.14, 0.5]}
        color={DARK_WOOD}
        map={wood}
        clearcoat={0.5}
        roughness={0.4}
      />
      {[-4.62, 4.62].map((x) => (
        <Box
          key={x}
          position={[x, 1.6, -0.05]}
          size={[0.16, 3.2, 2.6]}
          color={DARK_WOOD}
          map={wood}
          roughness={0.45}
        />
      ))}
    </group>
  );
}

/** Oak communal table on a blackened-steel frame; its top sits where every room's does. */
function CommunalTable({ top }: { top: THREE.Texture }) {
  return (
    <group>
      <Box
        position={[0, -0.19, 0]}
        size={[8.5, 0.36, 7.65]}
        color={OAK}
        map={top}
        clearcoat={0.3}
        roughness={0.5}
      />
      {[
        [
          [0, -0.47, 3.55],
          [8.0, 0.2, 0.08],
        ],
        [
          [0, -0.47, -3.55],
          [8.0, 0.2, 0.08],
        ],
        [
          [4.0, -0.47, 0],
          [0.08, 0.2, 7.1],
        ],
        [
          [-4.0, -0.47, 0],
          [0.08, 0.2, 7.1],
        ],
        [
          [3.9, -2.35, 0],
          [0.12, 0.12, 6.9],
        ],
        [
          [-3.9, -2.35, 0],
          [0.12, 0.12, 6.9],
        ],
        [
          [0, -1.9, 0],
          [7.8, 0.12, 0.12],
        ],
        ...[-3.9, 3.9].flatMap((x) =>
          [-3.45, 3.45].map(
            (z) =>
              [
                [x, -1.49, z],
                [0.2, 2.22, 0.2],
              ] as [Point, Point],
          ),
        ),
      ].map(([position, size], i) => (
        <Box
          key={i}
          position={position as Point}
          size={size as Point}
          color={IRON}
          metal={0.6}
          roughness={0.42}
        />
      ))}
    </group>
  );
}

function Cup({ position }: { position: Point }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.22, 0.2, 0.03, 24]} />
        <meshPhysicalMaterial color="#f6f3ec" roughness={0.3} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.1, 0.22, 20]} />
        <meshPhysicalMaterial color="#f6f3ec" roughness={0.3} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0.245, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.115, 20]} />
        <meshStandardMaterial color="#6b3e22" roughness={0.3} />
      </mesh>
    </group>
  );
}

/** A small marble-topped bistro table with a cast-iron base and two chairs. */
function BistroSet({
  position,
  marble,
  cane,
}: {
  position: Point;
  marble: THREE.Texture;
  cane: THREE.Texture;
}) {
  return (
    <group position={position}>
      <mesh position={[0, 2.45, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.9, 0.9, 0.08, 40]} />
        <meshPhysicalMaterial map={marble} roughness={0.3} clearcoat={0.6} />
      </mesh>
      <mesh position={[0, 1.3, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 2.3, 12]} />
        <meshStandardMaterial color={IRON} metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.5, 0.55, 0.1, 24]} />
        <meshStandardMaterial color={IRON} metalness={0.6} roughness={0.45} />
      </mesh>
      <Cup position={[0.25, 2.49, 0.15]} />
      <ThonetChair position={[0, 0, -1.35]} rotation={Math.PI} cane={cane} />
      <ThonetChair position={[0, 0, 1.35]} rotation={0} cane={cane} />
    </group>
  );
}

/** A fiddle-leaf fig in a terracotta pot. */
function FiddleLeaf({
  position,
  scale = 1,
}: {
  position: Point;
  scale?: number;
}) {
  const leaves = useMemo(() => {
    const random = seeded(Math.round(position[0] * 10 + position[2]));
    return Array.from({ length: 26 }, (_, i) => {
      const y = 2.0 + i * 0.13 + random() * 0.2;
      const angle = i * 2.4 + random() * 0.4;
      const reach = 0.35 + random() * 0.3;
      return {
        y,
        angle,
        reach,
        tilt: 0.5 + random() * 0.5,
        big: 0.85 + random() * 0.35,
      };
    });
  }, [position]);
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.55, 0.42, 1.1, 28]} />
        <meshStandardMaterial color="#b4643f" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.08, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 0.03, 24]} />
        <meshStandardMaterial color="#3a2a1c" roughness={1} />
      </mesh>
      <mesh position={[0, 3.0, 0]}>
        <cylinderGeometry args={[0.04, 0.07, 4, 8]} />
        <meshStandardMaterial color="#5a4630" roughness={0.9} />
      </mesh>
      {leaves.map(({ y, angle, reach, tilt, big }, i) => (
        <group key={i} position={[0, y, 0]} rotation={[0, angle, 0]}>
          <mesh
            position={[reach, 0.1, 0]}
            rotation={[0, 0, -tilt]}
            scale={[0.34 * big, 0.5 * big, 0.04]}
            castShadow
          >
            <sphereGeometry args={[1, 12, 10]} />
            <meshPhysicalMaterial
              color={i % 3 ? "#3f6a35" : "#4d7b3c"}
              roughness={0.55}
              clearcoat={0.4}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Espresso machine, grinders and pitchers along the back counter. */
function EspressoBar() {
  const chrome = (
    <meshStandardMaterial color="#dcdcd8" metalness={1} roughness={0.14} />
  );
  const front = -12.42;
  return (
    <group>
      <RoundedBox
        args={[2.6, 1.4, 1.1]}
        radius={0.12}
        position={[-6, 1.25, -13.0]}
        castShadow
      >
        {chrome}
      </RoundedBox>
      <Box
        position={[-6, 1.62, front - 0.02]}
        size={[2.3, 0.42, 0.04]}
        color="#8a1f1a"
        roughness={0.3}
        clearcoat={0.8}
      />
      {[-6.5, -5.5].map((x) => (
        <group key={x}>
          <mesh position={[x, 1.63, front + 0.01]} rotation={[0, 0, 0]}>
            <circleGeometry args={[0.13, 24]} />
            <meshStandardMaterial color="#f4f1e8" roughness={0.4} />
          </mesh>
          <mesh position={[x, 1.63, front + 0.005]}>
            <ringGeometry args={[0.13, 0.16, 24]} />
            {chrome}
          </mesh>
        </group>
      ))}
      {[-6.6, -5.4].map((x) => (
        <group key={x}>
          <mesh position={[x, 0.98, front + 0.1]} castShadow>
            <cylinderGeometry args={[0.15, 0.15, 0.2, 20]} />
            {chrome}
          </mesh>
          <mesh
            position={[x, 0.86, front + 0.42]}
            rotation={[Math.PI / 2 - 0.15, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.05, 0.06, 0.55, 12]} />
            <meshStandardMaterial color="#141414" roughness={0.4} />
          </mesh>
        </group>
      ))}
      {[-7.15, -4.85].map((x) => (
        <mesh
          key={x}
          position={[x, 0.95, front + 0.12]}
          rotation={[0.2, 0, x < -6 ? 0.15 : -0.15]}
        >
          <cylinderGeometry args={[0.025, 0.025, 0.8, 8]} />
          {chrome}
        </mesh>
      ))}
      <Box
        position={[-6, 0.6, front + 0.15]}
        size={[2.2, 0.08, 0.5]}
        color="#2a2a2a"
        metal={0.8}
        roughness={0.3}
      />
      {[-6.8, -6.4, -6, -5.6, -5.2].map((x) => (
        <mesh key={x} position={[x, 2.04, -13.0]}>
          <cylinderGeometry args={[0.13, 0.1, 0.2, 16]} />
          <meshPhysicalMaterial
            color="#f6f3ec"
            roughness={0.3}
            clearcoat={0.8}
          />
        </mesh>
      ))}
      {/* Two grinders with hoppers of beans. */}
      {[-9.6, -8.6].map((x) => (
        <group key={x} position={[x, 0.54, -13.0]}>
          <Box
            position={[0, 0.45, 0]}
            size={[0.6, 0.9, 0.7]}
            color="#1b1b1b"
            metal={0.4}
            roughness={0.35}
          />
          <mesh position={[0, 1.05, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.3, 16]} />
            {chrome}
          </mesh>
          <mesh position={[0, 1.5, 0]}>
            <cylinderGeometry args={[0.3, 0.13, 0.6, 20]} />
            <meshStandardMaterial
              color="#c9b49a"
              transparent
              opacity={0.35}
              roughness={0.1}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, 1.38, 0]}>
            <cylinderGeometry args={[0.22, 0.12, 0.34, 16]} />
            <meshStandardMaterial color="#3b2416" roughness={0.6} />
          </mesh>
        </group>
      ))}
      {[-3.6, -3.2].map((x, i) => (
        <mesh key={x} position={[x, 0.75, -12.8]} castShadow>
          <cylinderGeometry args={[0.14, 0.17, 0.4 + i * 0.08, 16]} />
          {chrome}
        </mesh>
      ))}
    </group>
  );
}

function Croissant({
  position,
  rotation,
}: {
  position: Point;
  rotation: number;
}) {
  return (
    <mesh
      position={position}
      rotation={[Math.PI / 2, 0, rotation]}
      scale={[1, 1, 0.75]}
    >
      <torusGeometry args={[0.16, 0.085, 10, 18, Math.PI * 1.25]} />
      <meshStandardMaterial color="#c98a3e" roughness={0.55} />
    </mesh>
  );
}

function Muffin({ position, colour }: { position: Point; colour: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.13, 0.1, 0.14, 14]} />
        <meshStandardMaterial color="#efe6d6" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.16, 0]} scale={[1, 0.7, 1]}>
        <sphereGeometry args={[0.16, 14, 10]} />
        <meshStandardMaterial color={colour} roughness={0.8} />
      </mesh>
    </group>
  );
}

/** The front counter: green tiled, marble-topped, with the pastry case and till. */
function FrontCounter({
  tile,
  marble,
}: {
  tile: THREE.Texture;
  marble: THREE.Texture;
}) {
  const top = 0.66;
  return (
    <group>
      <Box
        position={[-4.5, -1.05, -9.9]}
        size={[12, 3.1, 1.5]}
        color={TILE_GREEN}
        map={tile}
        roughness={0.2}
        clearcoat={0.6}
      />
      <Box
        position={[-4.5, 0.58, -9.85]}
        size={[12.3, 0.16, 1.75]}
        color="#ffffff"
        map={marble}
        roughness={0.28}
        clearcoat={0.6}
      />
      <Box
        position={[-4.5, -2.45, -9.13]}
        size={[12, 0.3, 0.06]}
        color={IRON}
      />
      {/* Pastry case: glass on a brass frame. */}
      <group position={[-8, top, -9.9]}>
        {[
          [-1.4, -0.6],
          [1.4, -0.6],
          [-1.4, 0.6],
          [1.4, 0.6],
        ].map(([x, z]) => (
          <Box
            key={`${x}-${z}`}
            position={[x, 0.65, z]}
            size={[0.05, 1.3, 0.05]}
            color={BRASS}
            metal={1}
            roughness={0.3}
          />
        ))}
        <Box
          position={[0, 0.03, 0]}
          size={[2.85, 0.06, 1.25]}
          color="#f1ece2"
          roughness={0.4}
        />
        <Box
          position={[0, 0.66, 0]}
          size={[2.8, 0.03, 1.2]}
          color="#dde6e2"
          roughness={0.1}
        />
        {[-1, -0.5, 0, 0.5, 1].flatMap((x, i) => [
          <Croissant
            key={`c${x}`}
            position={[x, 0.13, -0.2]}
            rotation={i * 0.7}
          />,
          <Croissant
            key={`d${x}`}
            position={[x + 0.2, 0.13, 0.25]}
            rotation={-i * 0.5}
          />,
        ])}
        {[-1, -0.6, -0.2, 0.2, 0.6, 1].map((x, i) => (
          <Muffin
            key={x}
            position={[x, 0.68, i % 2 ? 0.2 : -0.15]}
            colour={i % 3 ? "#7a4a26" : "#a86b38"}
          />
        ))}
        <mesh position={[0, 0.66, 0]} renderOrder={2}>
          <boxGeometry args={[2.8, 1.3, 1.2]} />
          <meshPhysicalMaterial
            color="#e4efea"
            transparent
            opacity={0.14}
            roughness={0.03}
            metalness={0.1}
            clearcoat={1}
            depthWrite={false}
          />
        </mesh>
      </group>
      {/* Till: a tablet on a stand, and a tip jar. */}
      <group position={[-3.5, top, -9.9]}>
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.04, 0.12, 0.3, 12]} />
          <meshStandardMaterial
            color="#c9c9c6"
            metalness={0.9}
            roughness={0.25}
          />
        </mesh>
        <mesh position={[0, 0.48, 0.05]} rotation={[-0.5, 0, 0]}>
          <boxGeometry args={[0.9, 0.62, 0.05]} />
          <meshStandardMaterial
            color="#121314"
            emissive="#2a3a48"
            emissiveIntensity={0.6}
            roughness={0.2}
          />
        </mesh>
      </group>
      <mesh position={[-2.5, top + 0.25, -9.6]}>
        <cylinderGeometry args={[0.18, 0.18, 0.5, 20]} />
        <meshStandardMaterial
          color="#dfe8e4"
          transparent
          opacity={0.3}
          roughness={0.05}
          depthWrite={false}
        />
      </mesh>
      {/* Cups stacked ready. */}
      {[-1.2, -0.75].flatMap((x) =>
        [0, 1, 2, 3].map((n) => (
          <mesh key={`${x}-${n}`} position={[x, top + 0.11 + n * 0.17, -10.1]}>
            <cylinderGeometry args={[0.15, 0.11, 0.2, 18]} />
            <meshPhysicalMaterial
              color="#f6f3ec"
              roughness={0.3}
              clearcoat={0.8}
            />
          </mesh>
        )),
      )}
    </group>
  );
}

/** Shelves of beans, jars and cups behind the bar, under the chalkboards. */
function BackBar({
  oak,
  boards,
}: {
  oak: THREE.Texture;
  boards: THREE.Texture[];
}) {
  const stock = useMemo(() => {
    const random = seeded(71);
    const boxes: [Point, Point][] = [];
    const colours: string[] = [];
    for (const shelf of [5.06, 6.76, 8.46]) {
      for (let x = -10.6; x < 2.6;) {
        const kind = random();
        if (kind < 0.55) {
          // Bags of beans: kraft, black or white, in short runs.
          const w = 0.55 + random() * 0.15;
          const h = 0.8 + random() * 0.25;
          boxes.push([
            [x + w / 2, shelf + h / 2, -13.32],
            [w, h, 0.32],
          ]);
          colours.push(
            ["#b48a5c", "#1f1f1f", "#ece7dc", "#a77a4c"][
              Math.floor(random() * 4)
            ],
          );
          x += w + 0.06;
        } else {
          x += 0.5 + random() * 0.6;
        }
      }
    }
    return { boxes, colours };
  }, []);
  const jars = useMemo(() => {
    const random = seeded(73);
    const out: Point[] = [];
    for (const shelf of [5.06, 6.76, 8.46])
      for (let i = 0; i < 6; i++)
        out.push([-10.2 + random() * 12.6, shelf, -13.3]);
    return out;
  }, []);
  return (
    <group>
      {[5.0, 6.7, 8.4].map((y) => (
        <Box
          key={y}
          position={[-4, y - 0.06, -13.32]}
          size={[14, 0.12, 0.46]}
          color={OAK}
          map={oak}
          roughness={0.5}
        />
      ))}
      <BoxInstances boxes={stock.boxes} colors={stock.colours}>
        <meshStandardMaterial color="#ffffff" roughness={0.75} />
      </BoxInstances>
      {jars.map((p, i) => (
        <group key={i} position={p}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.16, 0.16, 0.6, 16]} />
            <meshStandardMaterial
              color="#dfe8e4"
              transparent
              opacity={0.3}
              roughness={0.05}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.42, 14]} />
            <meshStandardMaterial
              color={i % 3 ? "#3b2416" : "#c58b4a"}
              roughness={0.7}
            />
          </mesh>
        </group>
      ))}
      {[-9.3, -4, 1.3].map((x, i) => (
        <group key={x}>
          <Box
            position={[x, 11, -13.5]}
            size={[4.6, 3.3, 0.08]}
            color={DARK_WOOD}
            map={oak}
            roughness={0.5}
          />
          <mesh position={[x, 11, -13.45]}>
            <planeGeometry args={[4.4, 3.1]} />
            <meshStandardMaterial map={boards[i]} roughness={0.95} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Pendant({ x, z, light }: { x: number; z: number; light: boolean }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 10.85, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 7.3, 6]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[0, 7.25, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.8, 0.65, 32, 1, true]} />
        <meshStandardMaterial
          color="#1e2a24"
          metalness={0.5}
          roughness={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 6.98, 0]}>
        <sphereGeometry args={[0.17, 16, 12]} />
        <meshBasicMaterial color="#ffe2b0" toneMapped={false} />
      </mesh>
      {light && (
        <pointLight
          position={[0, 6.7, 0]}
          color="#ffd9a6"
          intensity={4}
          distance={12}
          decay={2}
        />
      )}
    </group>
  );
}

function WallClock({ position }: { position: Point }) {
  return (
    <group position={position} rotation={[0, Math.PI, 0]}>
      <mesh rotation={[0, 0, 0]}>
        <torusGeometry args={[0.95, 0.09, 12, 48]} />
        <meshStandardMaterial color={IRON} metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, -0.03]}>
        <circleGeometry args={[0.92, 48]} />
        <meshStandardMaterial color="#f3efe4" roughness={0.6} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.sin(a) * 0.78, Math.cos(a) * 0.78, 0]}
            rotation={[0, 0, -a]}
          >
            <boxGeometry args={[0.03, i % 3 ? 0.08 : 0.16, 0.01]} />
            <meshStandardMaterial color="#1b1b1b" />
          </mesh>
        );
      })}
      {/* Ten past ten. */}
      <mesh position={[-0.2, 0.12, 0.02]} rotation={[0, 0, 1.05]}>
        <boxGeometry args={[0.05, 0.5, 0.01]} />
        <meshStandardMaterial color="#1b1b1b" />
      </mesh>
      <mesh position={[0.3, 0.17, 0.025]} rotation={[0, 0, -1.05]}>
        <boxGeometry args={[0.035, 0.7, 0.01]} />
        <meshStandardMaterial color="#1b1b1b" />
      </mesh>
    </group>
  );
}

function BarStool({ position }: { position: Point }) {
  return (
    <group position={position}>
      <mesh position={[0, 2.0, 0]} castShadow>
        <cylinderGeometry args={[0.45, 0.42, 0.12, 28]} />
        <meshPhysicalMaterial color={OAK} roughness={0.45} clearcoat={0.4} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.3, 1.0, Math.sin(a) * 0.3]}
            rotation={[Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08]}
            castShadow
          >
            <cylinderGeometry args={[0.035, 0.035, 2, 8]} />
            <meshStandardMaterial
              color={IRON}
              metalness={0.6}
              roughness={0.4}
            />
          </mesh>
        );
      })}
      <mesh position={[0, 0.75, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.025, 8, 32]} />
        <meshStandardMaterial color={IRON} metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Square concrete paving slabs: one repeat is 1.6 units. */
function makePaving() {
  const t = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = "#aca89f";
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#8e8a82";
    ctx.fillRect(0, 0, 256, 3);
    ctx.fillRect(0, 0, 3, 256);
    grain(ctx, 256, 256, 16, 97);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8.5 / 1.6, 150 / 1.6);
  return t;
}

// Window-bar stools: the bar stops short of the door.
const BAR_STOOLS = [-9, -5, -1, 3];
// The window-side plant stands in the back corner, clear of the bar and door.
const WINDOW_PLANT: Point = [-12.2, FLOOR_Y, -12.4];

// The entrance: a glazed door in the shopfront's last bay, nearest the front wall.
const DOOR_Z = 10.1;
const DOOR_WIDTH = 3.0;

/**
 * The shopfront: painted stallriser, steel-framed glass, the window bar,
 * and the way in — a glazed door with a brass pull — onto the street.
 */
function Shopfront({
  street,
  lettering,
  oak,
  paving,
}: {
  street: THREE.Texture;
  lettering: THREE.Texture;
  oak: THREE.Texture;
  paving: THREE.Texture;
}) {
  const x = -13.35;
  const doorLeft = DOOR_Z - DOOR_WIDTH / 2 - 0.1;
  const doorRight = DOOR_Z + DOOR_WIDTH / 2 + 0.1;
  // The stallriser and its trim stop either side of the door.
  const riser: [number, number][] = [
    [-14, doorLeft],
    [doorRight, 14],
  ];
  return (
    <group>
      {/* Across the road: far enough back that the facades read at their real
          size, and outside the fog, which is for the room's own depth. */}
      <mesh position={[-70, 58.9 - 37.5, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[150, 75]} />
        <meshBasicMaterial map={street} toneMapped={false} fog={false} />
      </mesh>
      {/* The sidewalk and road outside, seen down through the door and windows. */}
      <Box
        position={[-17.75, -2.72, 0]}
        size={[8.5, 0.2, 150]}
        color="#ffffff"
        map={paving}
        roughness={0.9}
      />
      <Box
        position={[-22, -2.75, 0]}
        size={[0.35, 0.3, 150]}
        color="#c9c5bb"
        roughness={0.8}
      />
      <Box
        position={[-46, -3.0, 0]}
        size={[48, 0.2, 150]}
        color="#4f5154"
        roughness={0.95}
      />
      {riser.map(([a, b]) => (
        <group key={a}>
          <Box
            position={[x - 0.05, -1.6, (a + b) / 2]}
            size={[0.3, 2.0, b - a]}
            color="#23392f"
            roughness={0.5}
          />
          <Box
            position={[x + 0.15, -0.62, (a + b) / 2]}
            size={[0.14, 0.14, b - a]}
            color="#e6e1d5"
            roughness={0.5}
          />
        </group>
      ))}
      {/* Door: steel frame, a glazed leaf with a brass kick plate and pull bar,
          a brass threshold and a coir mat inside. */}
      {[doorLeft, doorRight].map((z) => (
        <Box
          key={z}
          position={[x, 2.4, z]}
          size={[0.32, 10, 0.2]}
          color="#1a1c1b"
          metal={0.4}
          roughness={0.45}
        />
      ))}
      <Box
        position={[x, 7.5, DOOR_Z]}
        size={[0.32, 0.22, DOOR_WIDTH + 0.4]}
        color="#1a1c1b"
        metal={0.4}
        roughness={0.45}
      />
      {[DOOR_Z - DOOR_WIDTH / 2 + 0.1, DOOR_Z + DOOR_WIDTH / 2 - 0.1].map(
        (z) => (
          <Box
            key={z}
            position={[x + 0.05, 2.35, z]}
            size={[0.14, 9.8, 0.18]}
            color="#202322"
            metal={0.5}
            roughness={0.4}
          />
        ),
      )}
      <Box
        position={[x + 0.05, 7.15, DOOR_Z]}
        size={[0.14, 0.2, DOOR_WIDTH - 0.2]}
        color="#202322"
        metal={0.5}
        roughness={0.4}
      />
      <Box
        position={[x + 0.05, -2.1, DOOR_Z]}
        size={[0.14, 0.9, DOOR_WIDTH - 0.2]}
        color="#202322"
        metal={0.5}
        roughness={0.4}
      />
      <Box
        position={[x + 0.13, -2.1, DOOR_Z]}
        size={[0.02, 0.8, DOOR_WIDTH - 0.4]}
        color={BRASS}
        metal={1}
        roughness={0.3}
      />
      <mesh position={[x + 0.42, 2.6, DOOR_Z + 1.05]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 3.2, 12]} />
        <meshStandardMaterial color={BRASS} metalness={1} roughness={0.25} />
      </mesh>
      {[1.3, 3.9].map((y) => (
        <mesh
          key={y}
          position={[x + 0.27, y, DOOR_Z + 1.05]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[0.03, 0.03, 0.3, 8]} />
          <meshStandardMaterial color={BRASS} metalness={1} roughness={0.25} />
        </mesh>
      ))}
      <Box
        position={[x, -2.59, DOOR_Z]}
        size={[0.5, 0.03, DOOR_WIDTH]}
        color={BRASS}
        metal={1}
        roughness={0.35}
      />
      <Box
        position={[-12.3, -2.585, DOOR_Z]}
        size={[1.7, 0.04, DOOR_WIDTH]}
        color="#6b5638"
        roughness={1}
      />
      {[-13.6, -6.8, 0, 6.8, 13.6].map((z) => (
        <Box
          key={z}
          position={[x, 6.95, z]}
          size={[0.3, 15.1, 0.22]}
          color="#1a1c1b"
          metal={0.4}
          roughness={0.45}
        />
      ))}
      <Box
        position={[x, 10.6, 0]}
        size={[0.3, 0.22, 28]}
        color="#1a1c1b"
        metal={0.4}
        roughness={0.45}
      />
      <mesh
        position={[x + 0.02, 6.95, 0]}
        rotation={[0, Math.PI / 2, 0]}
        renderOrder={2}
      >
        <planeGeometry args={[28, 15.1]} />
        <meshStandardMaterial
          color="#d8e4e0"
          transparent
          opacity={0.1}
          metalness={0.3}
          roughness={0.05}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[x + 0.08, 5.3, 3.4]}
        rotation={[0, Math.PI / 2, 0]}
        renderOrder={3}
      >
        <planeGeometry args={[6.2, 1.82]} />
        <meshStandardMaterial
          map={lettering}
          transparent
          metalness={0.6}
          roughness={0.3}
          depthWrite={false}
        />
      </mesh>
      {/* The window bar and its stools. */}
      <Box
        position={[-12.65, 0.45, -2.75]}
        size={[1.1, 0.12, 16.5]}
        color={OAK}
        map={oak}
        roughness={0.45}
        clearcoat={0.4}
      />
      {[-10, -5, 0, 5].map((z) => (
        <Box
          key={z}
          position={[-12.95, 0.15, z]}
          size={[0.45, 0.45, 0.08]}
          color={IRON}
          metal={0.5}
        />
      ))}
      {BAR_STOOLS.map((z) => (
        <BarStool key={z} position={[-11.4, FLOOR_Y, z]} />
      ))}
    </group>
  );
}

const CAFE_FLOOR_SHADES: [number, number, number, number, number, number][] = [
  [0, FLOOR_Y, -6.3, 9.4, 2.6, 0.7], // banquette
  [0, FLOOR_Y, 6.2, 1.5, 1.5, 0.45], // chairs
  [-6.2, FLOOR_Y, 0, 1.5, 1.5, 0.45],
  [6.2, FLOOR_Y, 0, 1.5, 1.5, 0.45],
  [0, FLOOR_Y, 0, 8, 7.2, 0.3], // under the table
  [-4, FLOOR_Y, -13, 14, 1.1, 0.55], // back counter
  [-4.5, FLOOR_Y, -9.9, 12, 1.5, 0.6], // front counter
  [10.6, FLOOR_Y, -6, 1.1, 1.1, 0.45], // bistro tables
  [10.6, FLOOR_Y, 6, 1.1, 1.1, 0.45],
  [11.5, FLOOR_Y, 11.6, 1.1, 1.1, 0.55], // plants
  [WINDOW_PLANT[0], FLOOR_Y, WINDOW_PLANT[2], 1.1, 1.1, 0.55],
  ...BAR_STOOLS.map(
    (z) =>
      [-11.4, FLOOR_Y, z, 0.8, 0.8, 0.35] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
  ),
];

export function CafeRoom({ quality }: { quality: Quality }) {
  const topSource = useTexture("/textures/table-top.webp");
  const textures = useMemo(() => {
    const top = topSource.clone();
    top.colorSpace = THREE.SRGBColorSpace;
    top.anisotropy = quality === "low" ? 2 : 8;
    const floor = makeCheckerFloor();
    floor.repeat.set(27 / 1.6, 28 / 1.6);
    floor.anisotropy = quality === "low" ? 2 : 8;
    const subway = makeSubway();
    const brick = makeBrick();
    const tin = makeTin();
    tin.repeat.set(27 / 1.8, 28 / 1.8);
    const marble = canvasTexture(512, 512, (ctx) => {
      ctx.fillStyle = "#eee9e0";
      ctx.fillRect(0, 0, 512, 512);
      drawVeins(
        ctx,
        [0, 0, 512, 512],
        ["rgba(105,98,92,0.34)", "rgba(120,112,104,0.2)"],
        83,
      );
      grain(ctx, 512, 512, 6, 89);
    });
    return {
      top,
      floor,
      tin,
      marble,
      // One copy of each tiled surface per face size, so joints stay to scale.
      wallTile: tiled(subway.map, 27 / 3.2, 6.8 / 3.2),
      wallTileBump: tiled(subway.bump, 27 / 3.2, 6.8 / 3.2),
      counterTile: tiled(subway.map, 12 / 1.6, 3.1 / 1.6),
      brick: tiled(brick.map, 28 / 4.8, 17.2 / 1.6),
      brickBump: tiled(brick.bump, 28 / 4.8, 17.2 / 1.6),
      subwayMap: subway.map,
      subwayBump: subway.bump,
      brickMap: brick.map,
      brickBumpSource: brick.bump,
      street: makeStreet(),
      lettering: makeLettering(),
      paving: makePaving(),
      neon: makeNeon(),
      espressoPoster: makePoster("espresso"),
      beansPoster: makePoster("beans"),
      cane: makeCane(),
      boards: [
        makeChalkboard(
          "Coffee",
          [
            ["Espresso", "3.00"],
            ["Cortado", "3.75"],
            ["Flat white", "4.25"],
            ["Cappuccino", "4.25"],
            ["Latte", "4.50"],
            ["Mocha", "4.75"],
          ],
          101,
        ),
        makeChalkboard(
          "Pastries",
          [
            ["Croissant", "3.50"],
            ["Pain au chocolat", "4.00"],
            ["Almond croissant", "4.50"],
            ["Cardamom bun", "4.25"],
            ["Blueberry muffin", "3.75"],
          ],
          103,
        ),
        makeChalkboard(
          "& more",
          [
            ["Chai latte", "4.50"],
            ["Matcha", "4.75"],
            ["Hot chocolate", "4.00"],
            ["Lemonade", "3.50"],
            ["A game of Ludo", "free"],
          ],
          107,
        ),
      ],
      ...makeOcclusionTextures(),
    };
  }, [topSource, quality]);
  useEffect(
    () => () =>
      Object.values(textures)
        .flat()
        .forEach((t) => t.dispose()),
    [textures],
  );
  const t = textures;
  // Fewer lights on the lowest quality: each costs every lit surface.
  const both = quality !== "low";
  return (
    <group>
      <Box
        position={[0, -2.73, 0]}
        size={[27, 0.25, 28]}
        color="#ffffff"
        map={t.floor}
        roughness={0.22}
        clearcoat={0.4}
      />

      {/* Shell: green paint over tile on the back and front walls, brick on the right. */}
      <Box
        position={[0, 6, -13.7]}
        size={[27, 17.2, 0.3]}
        color={PAINT}
        roughness={0.85}
      />
      <Box
        position={[0, 6, 13.7]}
        size={[27, 17.2, 0.3]}
        color={PAINT}
        roughness={0.85}
      />
      {[-13.53, 13.53].map((z) => (
        <group key={z}>
          <mesh
            position={[0, 0.8, z]}
            rotation={[0, z < 0 ? 0 : Math.PI, 0]}
            receiveShadow
          >
            <planeGeometry args={[27, 6.8]} />
            <meshPhysicalMaterial
              map={t.wallTile}
              bumpMap={t.wallTileBump}
              bumpScale={1.5}
              roughness={0.18}
              clearcoat={0.6}
            />
          </mesh>
          <Box
            position={[0, 4.25, z - Math.sign(z) * 0.04]}
            size={[27, 0.16, 0.1]}
            color="#e6e1d5"
            roughness={0.3}
          />
        </group>
      ))}
      <mesh
        position={[13.5, 6, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        receiveShadow
      >
        <planeGeometry args={[28, 17.2]} />
        <meshStandardMaterial
          map={t.brick}
          bumpMap={t.brickBump}
          bumpScale={3}
          roughness={0.92}
        />
      </mesh>
      <mesh position={[0, CEILING_Y, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[27, 28]} />
        <meshStandardMaterial
          color="#e7e2d5"
          bumpMap={t.tin}
          bumpScale={4}
          metalness={0.25}
          roughness={0.45}
        />
      </mesh>
      {/* Crown where the walls meet the tin. */}
      <Box
        position={[0, 14.25, -13.45]}
        size={[27, 0.5, 0.2]}
        color="#e6e1d5"
        roughness={0.5}
      />
      <Box
        position={[0, 14.25, 13.45]}
        size={[27, 0.5, 0.2]}
        color="#e6e1d5"
        roughness={0.5}
      />
      <Box
        position={[13.3, 14.25, 0]}
        size={[0.2, 0.5, 28]}
        color="#e6e1d5"
        roughness={0.5}
      />

      <Shopfront
        street={t.street}
        lettering={t.lettering}
        oak={t.top}
        paving={t.paving}
      />

      {/* The bar along the back wall. */}
      <Box
        position={[-4, -1.1, -13.0]}
        size={[14, 3.0, 1.1]}
        color={DARK_WOOD}
        map={t.top}
        roughness={0.5}
      />
      <Box
        position={[-4, 0.47, -12.95]}
        size={[14.2, 0.14, 1.2]}
        color="#ffffff"
        map={t.marble}
        roughness={0.28}
        clearcoat={0.6}
      />
      <EspressoBar />
      <BackBar oak={t.top} boards={t.boards} />
      <FrontCounter tile={t.counterTile} marble={t.marble} />
      {[-8.5, -4.5, -0.5].map((x, i) => (
        <Pendant key={x} x={x} z={-9.9} light={i !== 1 && (both || i === 0)} />
      ))}

      {/* The brick wall: neon over two posters, and two bistro tables. */}
      <mesh position={[13.28, 9.4, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[6, 2.25]} />
        <meshBasicMaterial
          map={t.neon}
          transparent
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      {[
        [-6, t.espressoPoster],
        [6, t.beansPoster],
      ].map(([z, map]) => (
        <group key={z as number}>
          <Box
            position={[13.3, 5.4, z as number]}
            size={[0.08, 3.4, 2.6]}
            color={IRON}
            roughness={0.4}
          />
          <mesh
            position={[13.25, 5.4, z as number]}
            rotation={[0, -Math.PI / 2, 0]}
          >
            <planeGeometry args={[2.3, 3.07]} />
            <meshStandardMaterial map={map as THREE.Texture} roughness={0.7} />
          </mesh>
        </group>
      ))}
      <BistroSet
        position={[10.6, FLOOR_Y, -6]}
        marble={t.marble}
        cane={t.cane}
      />
      <BistroSet
        position={[10.6, FLOOR_Y, 6]}
        marble={t.marble}
        cane={t.cane}
      />

      <WallClock position={[-4, 8.6, 13.45]} />
      <FiddleLeaf position={[11.5, FLOOR_Y, 11.6]} scale={1.3} />
      <FiddleLeaf position={WINDOW_PLANT} scale={1.1} />

      {/* The party's table and seats. */}
      <Banquette wood={t.top} />
      <ThonetChair position={[0, FLOOR_Y, 6.2]} rotation={0} cane={t.cane} />
      <ThonetChair
        position={[-6.2, FLOOR_Y, 0]}
        rotation={-Math.PI / 2}
        cane={t.cane}
      />
      <ThonetChair
        position={[6.2, FLOOR_Y, 0]}
        rotation={Math.PI / 2}
        cane={t.cane}
      />
      <CommunalTable top={t.top} />

      {/* Daylight through the shop window, and shade into corners and under furniture. */}
      <Occlusion
        map={t.edge}
        position={[-10.4, -2.6, 0]}
        size={[28, 5.6]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        opacity={0.24}
        light
      />
      <Occlusion
        map={t.edge}
        position={[0, -2.6, -12.9]}
        size={[27, 1.2]}
        opacity={0.42}
      />
      <Occlusion
        map={t.edge}
        position={[12.7, -2.6, 0]}
        size={[28, 1.2]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        opacity={0.42}
      />
      <Occlusion
        map={t.edge}
        position={[0, -2.6, 12.9]}
        size={[27, 1.2]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
        opacity={0.42}
      />
      {CAFE_FLOOR_SHADES.map(([x, y, z, w, d, opacity], i) => (
        <Occlusion
          key={i}
          map={t.blob}
          position={[x, y, z]}
          size={[w / 0.7, d / 0.7]}
          opacity={opacity}
        />
      ))}
    </group>
  );
}
