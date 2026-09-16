"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Pawn, PlayerColor } from "@/lib/board/types";
import { BASE_AREA, GRID_SIZE } from "./boardLayout";

// Per direct instruction: a photorealistic 3D render of the whole board —
// slab, wood frame, and pieces — viewed at an ANGLE like a photo of a
// physical game on a table, not the flat top-down camera every other 3D
// layer in this app uses (an earlier flat pass never read as truly 3D no
// matter how good the materials were, and was fully reverted). This one
// canvas now owns BOTH the board and the pawns (merged from the former
// separate BoardScene3D/PawnScene3D split) so they share exactly one
// camera and can never drift out of alignment the way two independently
// tuned cameras could.
//
// The hard rule from every earlier 3D pass still holds: the real 2D DOM/
// CSS-Grid/Framer-Motion game logic (Board.tsx) is never modified in its
// own code paths. This file only READS from it (element rects for
// position, `legalPawnIds`/`pawns` for what to draw) and calls back into
// it (`onSelectPawn`) — same non-invasive relationship PawnScene3D always
// had, just now also true for the board's own visual.
const BOARD_SIZE = 10; // world units spanning the slab's top face
const SLAB_DEPTH = 1.3;
const RASTER_RESOLUTION = 1536;
const HIGHLIGHT_Y = 0.015; // just above the slab's top face, avoids z-fighting

interface BoardScene3DProps {
  svgWrapperRef: RefObject<HTMLDivElement | null>;
  activeColor: PlayerColor | null;
  pawns: readonly Pawn[];
  legalPawnIds: ReadonlySet<string>;
  anchorsRef: RefObject<Map<string, HTMLElement>>;
  containerRef: RefObject<HTMLDivElement | null>;
  onSelectPawn: (pawnId: string) => void;
}

export function BoardScene3D({
  svgWrapperRef,
  activeColor,
  pawns,
  legalPawnIds,
  anchorsRef,
  containerRef,
  onSelectPawn,
}: BoardScene3DProps) {
  const boardTexture = useBoardTexture(svgWrapperRef);
  const woodTexture = useWoodTexture();
  // Built once and shared by every pawn regardless of color — only the
  // material differs per pawn, never the shape.
  const bodyGeometry = useMemo(() => new THREE.LatheGeometry(buildBodyProfile(), 48), []);
  const ringGeometry = useMemo(() => new THREE.TorusGeometry(RING_RADIUS, RING_TUBE_RADIUS, 12, 48), []);

  return (
    // No pointer-events-none here, and none passed to <Canvas> either —
    // unlike the old flat PawnScene3D, THIS canvas is now the actual click
    // surface (see the matching pointer-events-none comments added to
    // NestSlot/PawnToken's own buttons in Board.tsx): r3f's built-in mesh
    // raycasting on each PawnMesh below calls the exact same onSelectPawn
    // callback those DOM buttons used to.
    <div className="absolute inset-0" style={{ zIndex: 6 }}>
      {/* `flat`: without it, r3f's default ACES tone mapping washes the
          rasterized board art's baked colors toward gray — see BoardSlab's
          own unlit top-face material for the other half of that fix.
          `shadows`: needed for the key light's castShadow + the slab's
          receiveShadow to actually produce a shadow map. */}
      <Canvas
        flat
        shadows
        camera={{ fov: 52, position: [0, 6.3, 9] }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        {/* Per direct instruction: rotate/zoom camera controls. `target`
            matches the fixed lookAt point this replaces — the same "aim
            slightly toward the viewer, not the exact board center" framing
            fix, just as OrbitControls' own orbit pivot instead of a
            one-time camera.lookAt() call (which OrbitControls would fight
            every frame otherwise, since it drives the camera transform
            continuously once mounted). `enablePan={false}` keeps the board
            centered in view — free panning would let a player scroll the
            board out of frame entirely, with no way back short of a page
            reload. Rotate/zoom bounds below keep the view from flipping
            under the table or zooming through the slab. */}
        <OrbitControls
          target={[0, 0, 1.3]}
          enablePan={false}
          minDistance={5}
          maxDistance={16}
          minPolarAngle={THREE.MathUtils.degToRad(12)}
          maxPolarAngle={THREE.MathUtils.degToRad(82)}
        />
        <ambientLight intensity={0.85} />
        <directionalLight
          position={[4, 8, 3]}
          intensity={1.7}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-left={-7}
          shadow-camera-right={7}
          shadow-camera-top={7}
          shadow-camera-bottom={-7}
        />
        {/* Dim fill from the opposite side so the far side of the frame
            and the underside of pawn bevels don't go fully black — real
            light bounces around a table, this is the cheap stand-in. */}
        <directionalLight position={[-4, 3, -3]} intensity={0.3} />
        {boardTexture && <BoardSlab boardTexture={boardTexture} woodTexture={woodTexture} />}
        <ContactShadows
          position={[0, -SLAB_DEPTH - 0.001, 0]}
          opacity={0.5}
          scale={BOARD_SIZE * 1.7}
          blur={1.8}
          far={3}
          resolution={512}
          color="#1a140d"
        />
        {(Object.keys(BASE_AREA) as PlayerColor[]).map((color) => (
          <ActiveHighlightFrame key={color} color={color} isActive={color === activeColor} />
        ))}
        {pawns.map((pawn) => (
          <PawnMesh
            key={pawn.id}
            pawn={pawn}
            isLegal={legalPawnIds.has(pawn.id)}
            anchorsRef={anchorsRef}
            containerRef={containerRef}
            bodyGeometry={bodyGeometry}
            ringGeometry={ringGeometry}
            onSelectPawn={onSelectPawn}
          />
        ))}
      </Canvas>
    </div>
  );
}

// Copies every element's ACTUAL resolved fill/stroke/color/opacity from
// the live (attached, correctly-styled) tree onto its structurally-
// identical clone (cloneNode(true), so both trees walk in perfect
// lockstep by children index) as plain inline styles. A detached/
// serialized SVG document has no access to the host's :root CSS custom
// properties OR Tailwind's compiled stylesheet, so naive var()/
// currentColor-driven fills silently resolve to black once cloned —
// walking the STILL-ATTACHED live tree (where getComputedStyle resolves
// everything regardless of mechanism) sidesteps that category of bug
// entirely rather than re-providing each mechanism one at a time.
function inlineComputedPaint(liveEl: Element, cloneEl: Element): void {
  const computed = getComputedStyle(liveEl);
  const style = (cloneEl as SVGElement).style;
  style.fill = computed.fill;
  style.stroke = computed.stroke;
  style.color = computed.color;
  style.opacity = computed.opacity;

  for (let i = 0; i < liveEl.children.length; i++) {
    const liveChild = liveEl.children[i];
    const cloneChild = cloneEl.children[i];
    if (liveChild && cloneChild) inlineComputedPaint(liveChild, cloneChild);
  }
}

// Rasterizes the hidden BoardArtwork SVG into a CanvasTexture exactly
// once — the board's own layout/colors are static for the whole match,
// so there's no reason to pay for re-rasterizing on every render.
function useBoardTexture(svgWrapperRef: RefObject<HTMLDivElement | null>): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const svg = svgWrapperRef.current?.querySelector("svg");
    if (!svg) return;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(RASTER_RESOLUTION));
    clone.setAttribute("height", String(RASTER_RESOLUTION));
    inlineComputedPaint(svg, clone);

    const svgString = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const canvas = document.createElement("canvas");
    canvas.width = RASTER_RESOLUTION;
    canvas.height = RASTER_RESOLUTION;
    const ctx = canvas.getContext("2d");

    const img = new Image();
    img.onload = () => {
      ctx?.drawImage(img, 0, 0, RASTER_RESOLUTION, RASTER_RESOLUTION);
      URL.revokeObjectURL(url);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      setTexture(tex);
    };
    img.onerror = (event) => {
      URL.revokeObjectURL(url);
      console.error("BoardScene3D: failed to rasterize the board SVG into a texture", event);
    };
    img.src = url;

    return () => URL.revokeObjectURL(url);
    // svgWrapperRef is a ref object — stable identity across renders — so
    // this intentionally runs once, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return texture;
}

// A real photographed, CC0-licensed wood texture (public/textures/
// board-wood.jpg, Poly Haven's "plywood" diffuse map — its pale, tight
// grain reads convincingly as a light maple-ish frame) — a hand-coded
// procedural grain was tried in an earlier pass and explicitly rejected
// ("looks nothing like maple wood"); a real photo doesn't have that
// problem. Loaded via Image()+canvas (not THREE.TextureLoader) to match
// this file's other texture pipeline and allow tiling + a vignette in
// the same canvas pass.
function useWoodTexture(): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const size = 1024;
      const tiles = 3;
      const tileSize = size / tiles;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        for (let ty = 0; ty < tiles; ty++) {
          for (let tx = 0; tx < tiles; tx++) {
            ctx.drawImage(img, tx * tileSize, ty * tileSize, tileSize, tileSize);
          }
        }
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      setTexture(tex);
    };
    img.onerror = (event) => {
      console.error("BoardScene3D: failed to load the wood frame texture", event);
    };
    img.src = "/textures/board-wood.jpg";

    return () => {
      cancelled = true;
    };
  }, []);

  return texture;
}

// The board as a real slab with depth, top face at local/world y=0 (where
// pawns rest) and extending down toward the table.
function BoardSlab({
  boardTexture,
  woodTexture,
}: {
  boardTexture: THREE.CanvasTexture;
  woodTexture: THREE.CanvasTexture | null;
}) {
  // `key`: r3f reuses the same material instance across re-renders and
  // just mutates its properties, but three.js decides at COMPILE time
  // whether a material's shader samples a map at all — a material first
  // compiled with `map={null}` (before the async-loaded wood photo
  // arrives) keeps running that no-texture shader even after `.map` is
  // later set to a real texture. Swapping `key` forces React to mount a
  // brand-new mesh/material once the texture is ready, so the "loaded"
  // material is compiled with the map present from its very first frame.
  const edgeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: woodTexture ? "#ffffff" : "#c9a06a",
        map: woodTexture,
        roughness: 0.6,
        metalness: 0,
      }),
    [woodTexture],
  );
  // MeshBasicMaterial (unlit), not MeshStandardMaterial: this texture is
  // already-finished 2D art — running it through PBR shading a second
  // time on top of what's already baked in only dims/desaturates it
  // further. The edge faces stay lit (MeshStandardMaterial) for a real
  // depth cue on the frame.
  const topMaterial = useMemo(() => new THREE.MeshBasicMaterial({ map: boardTexture }), [boardTexture]);
  // Box face order is [+x, -x, +y, -y, +z, -z] — index 2 is +y, "up"
  // toward the camera in this horizontal-plane scene.
  const materials = useMemo(
    () => [edgeMaterial, edgeMaterial, topMaterial, edgeMaterial, edgeMaterial, edgeMaterial],
    [edgeMaterial, topMaterial],
  );

  return (
    <mesh key={woodTexture ? "wood-photo" : "wood-fallback"} position={[0, -SLAB_DEPTH / 2, 0]} material={materials} receiveShadow>
      <boxGeometry args={[BOARD_SIZE, SLAB_DEPTH, BOARD_SIZE]} />
    </mesh>
  );
}

// A square outline over one base quadrant, pulsing when it's that
// color's turn — the 3D-native replacement for the animated highlight
// BoardArtwork's own (now-hidden) SVG used to draw, since a one-time
// texture raster can't carry a live CSS animation.
function ActiveHighlightFrame({ color, isActive }: { color: PlayerColor; isActive: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const area = BASE_AREA[color];
  const materialColor = useMemo(() => new THREE.Color(QUADRANT_BORDER_COLOR[color]), [color]);

  // Same grid-space -> world-space conversion the pawns use (below), just
  // driven by the color's own known base-quadrant grid region instead of
  // a live DOM rect — a highlight frame has no single DOM element of its
  // own to read a position from.
  const size = ((area.colEnd - area.colStart + 1) / GRID_SIZE) * BOARD_SIZE;
  const centerCol = (area.colStart + area.colEnd + 1) / 2;
  const centerRow = (area.rowStart + area.rowEnd + 1) / 2;
  const worldX = (centerCol / GRID_SIZE - 0.5) * BOARD_SIZE;
  const worldZ = (centerRow / GRID_SIZE - 0.5) * BOARD_SIZE;

  const barThickness = size * 0.03;
  const half = size / 2;

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    group.visible = isActive;
    if (!isActive) return;
    const pulse = 0.5 + Math.sin(clock.elapsedTime * 2.6) * 0.5; // 0..1
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = 0.6 + pulse * 1.2;
      material.opacity = 0.55 + pulse * 0.35;
    }
  });

  return (
    <group ref={groupRef} position={[worldX, HIGHLIGHT_Y, worldZ]} visible={false}>
      {/* "top"/"bottom" edges (long in X, thin in Z) */}
      <mesh position={[0, 0, half - barThickness / 2]}>
        <boxGeometry args={[size, barThickness, barThickness]} />
        <meshStandardMaterial color={materialColor} emissive={materialColor} transparent />
      </mesh>
      <mesh position={[0, 0, -half + barThickness / 2]}>
        <boxGeometry args={[size, barThickness, barThickness]} />
        <meshStandardMaterial color={materialColor} emissive={materialColor} transparent />
      </mesh>
      {/* "left"/"right" edges (long in Z, thin in X) */}
      <mesh position={[-half + barThickness / 2, 0, 0]}>
        <boxGeometry args={[barThickness, barThickness, size]} />
        <meshStandardMaterial color={materialColor} emissive={materialColor} transparent />
      </mesh>
      <mesh position={[half - barThickness / 2, 0, 0]}>
        <boxGeometry args={[barThickness, barThickness, size]} />
        <meshStandardMaterial color={materialColor} emissive={materialColor} transparent />
      </mesh>
    </group>
  );
}

// Same --quadrant-*-border variables StatusPod/Dice already use for this
// exact "active turn" accent.
const QUADRANT_BORDER_COLOR: Record<PlayerColor, string> = {
  red: "#f4888c",
  green: "#8cd9a5",
  yellow: "#ffe066",
  blue: "#8a8cc9",
};

// The board's own quadrant colors (globals.css's --quadrant-* variables)
// — the pawn body uses these exactly, matching the base square it sits
// on rather than a lightened variant (an earlier attempt at that made all
// four too close to indistinguishable pale colors).
const QUADRANT_COLOR: Record<PlayerColor, string> = {
  red: "#ed1c24",
  green: "#45b862",
  yellow: "#f2c200",
  blue: "#2e3192",
};
const PAWN_COLOR_DARK: Record<PlayerColor, string> = {
  red: "#9f1118",
  green: "#176d32",
  yellow: "#b98d00",
  blue: "#17194f",
};

// The token's own shape — a rounded, beveled-edge disc/coin with a darker
// inset ring. THREE has no "rounded cylinder" primitive, so this revolves
// a hand-built 2D profile (flat top -> quarter-circle bevel -> flat side
// -> quarter-circle bevel -> flat bottom) around an axis with
// LatheGeometry instead.
const BODY_OUTER_RADIUS = 0.5;
const BODY_BEVEL_RADIUS = 0.1;
const BODY_HALF_HEIGHT = 0.28;
const RING_RADIUS = 0.32;
const RING_TUBE_RADIUS = 0.018;

function buildBodyProfile(): THREE.Vector2[] {
  const flatRadius = BODY_OUTER_RADIUS - BODY_BEVEL_RADIUS;
  const flatHalfHeight = BODY_HALF_HEIGHT - BODY_BEVEL_RADIUS;
  const arcSegments = 10;
  const points: THREE.Vector2[] = [];

  points.push(new THREE.Vector2(0, BODY_HALF_HEIGHT));
  points.push(new THREE.Vector2(flatRadius, BODY_HALF_HEIGHT));

  for (let i = 1; i <= arcSegments; i++) {
    const t = (i / arcSegments) * (Math.PI / 2);
    points.push(
      new THREE.Vector2(flatRadius + BODY_BEVEL_RADIUS * Math.sin(t), flatHalfHeight + BODY_BEVEL_RADIUS * Math.cos(t)),
    );
  }
  for (let i = 0; i <= arcSegments; i++) {
    const t = (i / arcSegments) * (Math.PI / 2);
    const mirroredT = Math.PI / 2 - t;
    points.push(
      new THREE.Vector2(
        flatRadius + BODY_BEVEL_RADIUS * Math.sin(mirroredT),
        -flatHalfHeight - BODY_BEVEL_RADIUS * Math.cos(mirroredT),
      ),
    );
  }
  points.push(new THREE.Vector2(0, -BODY_HALF_HEIGHT));

  return points;
}

// A small, deterministic per-pawn height jitter so two same-color pawns
// stacked on one cell (Board.tsx's own -ml-[46%] CSS offset for that
// case) don't sit at the exact same Y — without it, raycasting between
// two coincident meshes for a click has no reliable "topmost" winner.
function stackJitter(pawnId: string): number {
  let hash = 0;
  for (let i = 0; i < pawnId.length; i++) hash = (hash * 31 + pawnId.charCodeAt(i)) >>> 0;
  return (hash % 7) * 0.003;
}

function PawnMesh({
  pawn,
  isLegal,
  anchorsRef,
  containerRef,
  bodyGeometry,
  ringGeometry,
  onSelectPawn,
}: {
  pawn: Pawn;
  isLegal: boolean;
  anchorsRef: RefObject<Map<string, HTMLElement>>;
  containerRef: RefObject<HTMLDivElement | null>;
  bodyGeometry: THREE.LatheGeometry;
  ringGeometry: THREE.TorusGeometry;
  onSelectPawn: (pawnId: string) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyColor = useMemo(() => new THREE.Color(QUADRANT_COLOR[pawn.color]), [pawn.color]);
  const ringColor = useMemo(() => new THREE.Color(PAWN_COLOR_DARK[pawn.color]), [pawn.color]);
  const jitter = useMemo(() => stackJitter(pawn.id), [pawn.id]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const container = containerRef.current;
    if (!group) return;

    const anchor = anchorsRef.current.get(pawn.id);
    if (!container || !anchor) {
      group.visible = false;
      return;
    }

    const containerRect = container.getBoundingClientRect();
    if (containerRect.width === 0) {
      group.visible = false;
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    // anchorRect can be 0 for a brand-new nest slot ref on its very first
    // frame before layout settles — skip rather than flash at the origin.
    if (anchorRect.width === 0) {
      group.visible = false;
      return;
    }

    const nx = (anchorRect.left + anchorRect.width / 2 - containerRect.left) / containerRect.width;
    const nz = (anchorRect.top + anchorRect.height / 2 - containerRect.top) / containerRect.height;
    const worldX = (nx - 0.5) * BOARD_SIZE;
    const worldZ = (nz - 0.5) * BOARD_SIZE;
    const worldDiameter = (anchorRect.width / containerRect.width) * BOARD_SIZE;

    // Same pulse the CSS glow already plays for a tappable pawn
    // (ludo-piece-legal, globals.css) — echoed here so the 3D token
    // itself breathes along with its own glow ring.
    const pulse = isLegal ? 1 + Math.sin(clock.elapsedTime * 3.4) * 0.06 : 1;

    // The group's local origin sits at the puck's own vertical center
    // (the body mesh spans -BODY_HALF_HEIGHT..+BODY_HALF_HEIGHT locally),
    // and BODY_OUTER_RADIUS is exactly 0.5 — i.e. the body's local
    // diameter is exactly 1.0 — so `worldDiameter` doubles as the uniform
    // scale factor AND the puck's actual world-space diameter. Lifting
    // the group by (scale * BODY_HALF_HEIGHT) puts the puck's bottom face
    // exactly on the slab's top face (world y=0) rather than halfway
    // through it.
    const scale = worldDiameter * pulse;
    group.visible = true;
    group.position.set(worldX, scale * BODY_HALF_HEIGHT + jitter, worldZ);
    group.scale.setScalar(scale);
  });

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    if (isLegal) onSelectPawn(pawn.id);
  }

  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    if (!isLegal) return;
    event.stopPropagation();
    document.body.style.cursor = "pointer";
  }

  function handlePointerOut() {
    document.body.style.cursor = "auto";
  }

  return (
    // No camera-facing rotation here — unlike the old flat orthographic
    // scene, the lathe profile's own revolve axis (+Y) already IS "up" on
    // this horizontal board, so the flat top face already faces world +Y
    // with no reorientation needed.
    <group ref={groupRef} onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
      <mesh geometry={bodyGeometry} castShadow>
        {/* A slight glow, as if made of glass — `transmission` is what
            actually makes it read as glass rather than plastic, kept
            modest so it stays a "slight" glow. `emissive` adds a soft
            self-lit warmth from within, echoing the piece's own color.
            `side={THREE.DoubleSide}`: under the OLD flat orthographic
            camera this body mesh was always viewed from one fixed
            direction, so a latent LatheGeometry winding/normal quirk
            never showed; viewed from this new angled camera it read as
            partly hollow/see-through without this. */}
        <meshPhysicalMaterial
          color={bodyColor}
          roughness={0.15}
          clearcoat={1}
          clearcoatRoughness={0.05}
          metalness={0.02}
          transmission={0.35}
          thickness={0.6}
          ior={1.4}
          emissive={bodyColor}
          emissiveIntensity={0.22}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* The inset ring, sitting just above the flat top face so it
          doesn't z-fight with it. TorusGeometry's default hole-axis is Z,
          rotated 90° here to lie flat against the body's own local +Y
          top face (this rotation is about the BODY's own local space, not
          the outer group — unaffected by removing the group's old
          camera-facing rotation). */}
      <mesh geometry={ringGeometry} position={[0, BODY_HALF_HEIGHT - 0.006, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <meshPhysicalMaterial
          color={ringColor}
          roughness={0.3}
          clearcoat={0.6}
          metalness={0.05}
          emissive={ringColor}
          emissiveIntensity={0.12}
        />
      </mesh>
    </group>
  );
}
