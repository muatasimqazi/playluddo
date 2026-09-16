"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Pawn, PlayerColor } from "@/lib/board/types";

// Per direct instruction: real 3D pawns, but built to never touch any of
// the actual game logic — positioning (grid cells, nest slots, home lane,
// finished piles), the multi-cell hop path, layoutId FLIP transitions,
// click handling, and legal-move state all stay exactly the untouched
// Board.tsx/Framer Motion system they already were. This canvas doesn't
// know any of that: each pawn's existing DOM element (still fully
// present, just visually voided by .ludo-piece-3d-hidden in globals.css)
// is the single source of truth for where its 3D token belongs. Every
// frame, PawnMesh reads that element's OWN getBoundingClientRect() —
// wherever Framer Motion has it *right now*, mid-hop or at rest — and
// places the 3D token there. This is also why it's one shared canvas for
// every pawn rather than one each: up to 16 pawns can be on screen at
// once, and that many separate WebGL contexts risks hitting a browser's
// per-page context limit (commonly ~16, and BoardBackdrop's own canvas
// already uses one).
const VISIBLE_SPAN = 10;

// The board's own quadrant colors (globals.css's --quadrant-* variables)
// — per direct instruction, the pawn body uses these exactly. An earlier
// pass lightened them toward white to stand out against a same-color
// nest/base square, but at that lift all four ended up close enough to
// each other (and to white) to read as one indistinguishable pale color
// instead of four; whatever contrast a pawn needs against its own base
// square is the ring accent's job (PAWN_COLOR_DARK below) and the
// material's own clearcoat/transmission highlights, not a shifted body
// hue.
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

// The token's own shape, per direct instruction ("make it look like this
// [reference: a rounded, beveled-edge disc/coin with a darker inset
// ring]") — a plain squashed sphere (this file's first pass) reads as a
// smooth lens/dome, not the flat-topped, rounded-edge puck the reference
// shows. THREE has no "rounded cylinder" primitive, so this revolves a
// hand-built 2D profile (flat top → quarter-circle bevel → flat side →
// quarter-circle bevel → flat bottom) around an axis with LatheGeometry
// instead — see buildBodyProfile below for the actual coordinates.
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

  // Top bevel: quarter circle from the flat top's own edge down to where
  // the flat side begins, center at (flatRadius, flatHalfHeight).
  for (let i = 1; i <= arcSegments; i++) {
    const t = (i / arcSegments) * (Math.PI / 2);
    points.push(
      new THREE.Vector2(flatRadius + BODY_BEVEL_RADIUS * Math.sin(t), flatHalfHeight + BODY_BEVEL_RADIUS * Math.cos(t)),
    );
  }
  // Bottom bevel: mirror of the top, center at (flatRadius, -flatHalfHeight).
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

interface PawnScene3DProps {
  pawns: readonly Pawn[];
  legalPawnIds: ReadonlySet<string>;
  anchorsRef: RefObject<Map<string, HTMLElement>>;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function PawnScene3D({ pawns, legalPawnIds, anchorsRef, containerRef }: PawnScene3DProps) {
  // Built once and shared by every pawn regardless of color — only the
  // material differs per pawn, never the shape.
  const bodyGeometry = useMemo(() => new THREE.LatheGeometry(buildBodyProfile(), 48), []);
  const ringGeometry = useMemo(() => new THREE.TorusGeometry(RING_RADIUS, RING_TUBE_RADIUS, 12, 48), []);

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 6 }} aria-hidden>
      {/* `style={{ pointerEvents: "none" }}` here too, not just on the
          wrapper div above: r3f's own <Canvas> unconditionally sets
          `pointer-events: auto` as an inline style on the root div IT
          creates around the actual <canvas> — so its own internal
          raycasting event system keeps working regardless of anything
          an ancestor does. An inline style set directly on an element
          always overrides an inherited value, so the wrapper's own
          pointer-events-none never actually reached this canvas: sitting
          at zIndex 6 (above every pawn button), it silently swallowed
          every click meant for the real DOM pawn underneath — no pawn,
          in any color, was ever actually clickable through it. Passing
          our OWN pointerEvents:none as a style prop here overrides r3f's
          default the same inline-style way, since r3f merges this prop
          into that same root div's style rather than replacing it. */}
      <Canvas
        orthographic
        camera={{ position: [0, 0, 10] }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        style={{ pointerEvents: "none" }}
      >
        <ResponsiveZoom />
        <ambientLight intensity={1.5} />
        <directionalLight position={[-3, 4, 6]} intensity={1.9} />
        {/* A dim fill from the opposite side so the underside of the
            bevel doesn't go fully black — real light bounces around a
            desk, this is the cheap stand-in for that without a second
            full shadow pass. */}
        <directionalLight position={[3, -2, 3]} intensity={0.4} />
        {pawns.map((pawn) => (
          <PawnMesh
            key={pawn.id}
            pawn={pawn}
            isLegal={legalPawnIds.has(pawn.id)}
            anchorsRef={anchorsRef}
            containerRef={containerRef}
            bodyGeometry={bodyGeometry}
            ringGeometry={ringGeometry}
          />
        ))}
      </Canvas>
    </div>
  );
}

// Keeps VISIBLE_SPAN world units visible across the canvas's shorter side
// no matter its actual pixel size — same technique as BoardBackdrop's own
// ResponsiveZoom (this board resizes responsively, so a fixed zoom only
// keeps the intended world-to-pixel ratio at whatever size it was tuned
// against). Duplicated rather than shared: these are two independent,
// decorative-only canvases with no other coupling, and this is a handful
// of lines.
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

function PawnMesh({
  pawn,
  isLegal,
  anchorsRef,
  containerRef,
  bodyGeometry,
  ringGeometry,
}: {
  pawn: Pawn;
  isLegal: boolean;
  anchorsRef: RefObject<Map<string, HTMLElement>>;
  containerRef: RefObject<HTMLDivElement | null>;
  bodyGeometry: THREE.LatheGeometry;
  ringGeometry: THREE.TorusGeometry;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyColor = useMemo(() => new THREE.Color(QUADRANT_COLOR[pawn.color]), [pawn.color]);
  const ringColor = useMemo(() => new THREE.Color(PAWN_COLOR_DARK[pawn.color]), [pawn.color]);

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
    const ny = (anchorRect.top + anchorRect.height / 2 - containerRect.top) / containerRect.height;
    const worldX = (nx - 0.5) * VISIBLE_SPAN;
    const worldY = -(ny - 0.5) * VISIBLE_SPAN;
    const worldDiameter = (anchorRect.width / containerRect.width) * VISIBLE_SPAN;

    // Same pulse the CSS glow already plays for a tappable pawn
    // (ludo-piece-legal, globals.css) — echoed here so the 3D token
    // itself breathes along with its own glow ring instead of sitting
    // still inside a pulsing halo.
    const pulse = isLegal ? 1 + Math.sin(clock.elapsedTime * 3.4) * 0.06 : 1;

    group.visible = true;
    group.position.set(worldX, worldY, 0);
    group.scale.setScalar(worldDiameter * pulse);
  });

  return (
    // rotation.x: the lathe body/ring are built in the profile's own X-Y
    // plane (its rotational axis is Y — see buildBodyProfile), but this
    // scene's camera looks straight down -Z, so the flat face needs to
    // be reoriented to face +Z (toward the camera) instead of +Y (up in
    // the profile's own space). +90° puts profile-space +Y at world +Z.
    <group ref={groupRef} rotation={[Math.PI / 2, 0, 0]}>
      <mesh geometry={bodyGeometry}>
        {/* Per direct instruction: a glass-like glow. `transmission` is
            what actually makes it read as glass rather than plastic —
            light passes through instead of just bouncing off the
            surface — kept modest (0.35) so it stays a "slight" glow, not
            a fully see-through piece. `emissive` at low intensity adds
            the second half of that look: a soft self-lit warmth from
            within, echoing the piece's own color, on top of whatever
            transmission alone would give it. */}
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
        />
      </mesh>
      {/* The reference's inset ring, sitting just above the flat top
          face so it doesn't z-fight with it. Rotated 90° in ITS OWN local
          space too: TorusGeometry's default hole-axis is Z, and this
          needs it along the profile's Y to lie flat against that face.
          Left solid (no transmission) — thin transmissive geometry tends
          to render with artifacts, and the ring reads better as a
          distinct opaque accent than dissolving into the same glow. */}
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
