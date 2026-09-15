"use client";

import { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";

// Every size below is a fraction of this fixed WORLD-SPACE span, kept
// visible across the canvas regardless of the canvas's actual pixel size
// by ResponsiveZoom (below) recomputing the orthographic camera's zoom on
// every resize — zoom is "world units visible per pixel," so a FIXED
// zoom value (this component's first pass used a static 90, then 70)
// only keeps that ratio at whatever pixel size it was tuned against: the
// board frame is itself responsive (MatchArena/Board.tsx), and at a
// mobile width the same fixed zoom left the canvas showing far FEWER
// world units than at desktop — shrinking the visible frustum below
// BOARD_OCCLUDER_SIZE's fixed world size, so its "shadow" once again
// covered the entire frame uniformly instead of falling off near the
// board's edge (the exact flat-gray bug this file already fixed once,
// recurring for the same underlying reason at a different breakpoint).
const VISIBLE_SPAN = 6.3;
// The board fills most of its frame (thin p-3/sm:p-5 padding — see
// Board.tsx) — this doesn't track that padding live, it's a fixed
// proportion tuned to look right at common sizes; exact per-breakpoint
// alignment isn't the point of a background mood effect.
const BOARD_OCCLUDER_SIZE = VISIBLE_SPAN * 0.86;

// Per direct instruction ("recreate the depth/shadow of a craft mat like
// this photo"), but scoped to atmosphere only: the actual game board and
// pawns below are untouched 2D DOM/SVG + Framer Motion, exactly as every
// other fix this session left them. This is a purely decorative three.js
// layer sitting BEHIND that board (see Board.tsx), visible only in the
// margin around it, giving the impression the board is a solid object
// resting on a lit table surface rather than a flat rectangle floating on
// a plain background.
//
// Deliberately top-down/orthographic, not the reference photo's angled
// shot: the real board above renders perfectly flat and head-on, so a
// perspective-skewed mat behind it would visibly mismatch (grid lines
// converging one way, the board's own grid perfectly square) rather than
// reading as one consistent surface.
export function BoardBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 10] }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <ResponsiveZoom />
        <ambientLight intensity={1.1} />
        {/* Angled key light is what gives the mat's grid lines and the
            board's contact shadow their sense of depth, even though the
            camera itself is flat top-down. */}
        <directionalLight position={[2.5, 4, 5]} intensity={1.4} />
        <MatSurface />
        {/* drei's ContactShadows renders whatever geometry sits above its
            own plane into a blurred shadow texture — BoardOccluder below
            is that geometry. Its own material is irrelevant to the final
            picture (the real 2D board, painted in the DOM above this
            canvas, fully covers it at BOARD_OCCLUDER_SIZE's own scale);
            only the soft shadow it casts, which blurs outward past its
            edges into the visible margin, shows. */}
        <BoardOccluder />
        <ContactShadows
          position={[0, 0, -0.05]}
          opacity={0.45}
          scale={VISIBLE_SPAN * 1.4}
          blur={1.6}
          far={2}
          resolution={512}
          color="#241f14"
        />
      </Canvas>
    </div>
  );
}

// Keeps VISIBLE_SPAN world units visible across the canvas's shorter
// side no matter its actual pixel size, so every fixed world-space size
// below stays in the same proportion to the visible frustum at any
// breakpoint — see the comment on VISIBLE_SPAN above for why a static
// zoom can't do this.
function ResponsiveZoom() {
  const { camera, size } = useThree();
  useEffect(() => {
    const zoom = Math.min(size.width, size.height) / VISIBLE_SPAN;
    // eslint-disable-next-line react-hooks/immutability -- `camera` is a live three.js Object3D from the scene graph, not React state; setting its own properties directly is the standard three.js/r3f API for driving it imperatively.
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function BoardOccluder() {
  return (
    <mesh position={[0, 0, 0.3]}>
      <boxGeometry args={[BOARD_OCCLUDER_SIZE, BOARD_OCCLUDER_SIZE, 0.3]} />
      <meshStandardMaterial color="#ffffff" />
    </mesh>
  );
}

function MatSurface() {
  const texture = useMemo(() => createMatTexture(), []);
  return (
    <mesh position={[0, 0, -0.5]}>
      <planeGeometry args={[VISIBLE_SPAN * 1.6, VISIBLE_SPAN * 1.6]} />
      <meshStandardMaterial map={texture} roughness={0.95} metalness={0} />
    </mesh>
  );
}

// A warm, muted grid — evokes the reference photo's cutting-mat texture
// without importing its saturated green, which would clash with
// DESIGN.md's "Modern Boardroom" neutral palette. Procedural (drawn once
// into an offscreen canvas), not an image asset — no new binary to ship
// for a background that's mostly obscured by the board sitting on it.
function createMatTexture(): THREE.CanvasTexture {
  const size = 1024;
  const divisions = 20;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = "#5b6355";
  ctx.fillRect(0, 0, size, size);

  const step = size / divisions;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= divisions; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(size, i * step);
    ctx.stroke();
  }

  // A subtle vignette so the mat reads as lit from above rather than a
  // flat, uniformly-bright texture — reinforces the directional light
  // already in the scene instead of fighting it.
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.7);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
