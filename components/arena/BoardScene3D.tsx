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
// A flat photo backdrop plane was tried first (and, before that, a photo
// plane + a separate flat-color floor plane in front of it) — but
// OrbitControls lets the camera orbit a full 360° around the board with
// no azimuth limit, and a flat plane (or any room missing even one wall)
// necessarily runs out at some angle: past its own forward-facing arc,
// orbiting shows it edge-on or from behind, reading as the image being
// "cut off." The only fix that actually holds at every orbit angle is a
// genuinely ENCLOSED room — floor, ceiling, and all 4 walls — sized well
// past the camera's own max orbit distance so nothing can ever clip a
// wall. Built as one inside-out box (ROOM_SIZE below) rather than 5
// separate planes: a single box with a 6-entry material array (same
// per-face-materials pattern BoardSlab already uses) can't accidentally
// leave a gap at a seam or get one wall's rotation sign wrong the way 5
// independently-placed/rotated planes could.
// Coffee table the board actually sits on. Previously "the table" was
// only ever the flat backdrop photo's own table, coincidentally visible
// behind the board — removing that photo means the board needs a real
// table under it now. Sized to visibly extend past the board's own
// footprint (BOARD_SIZE) on every side, like an actual table a board
// would be placed on rather than one sized to exactly match it.
const TABLE_TOP_WIDTH = BOARD_SIZE + 3.5;
const TABLE_TOP_DEPTH = BOARD_SIZE + 3.5;
const TABLE_TOP_THICKNESS = 0.5;
// Board slab's own top face is at world y=0 (BoardSlab positions itself
// at -SLAB_DEPTH/2, spanning -SLAB_DEPTH..0) — the table top sits flush
// just under that, and the legs continue down to the room's floor.
const TABLE_LEG_HEIGHT = 3.4;
const TABLE_TOP_Y = -SLAB_DEPTH - TABLE_TOP_THICKNESS / 2;
const TABLE_FLOOR_Y = TABLE_TOP_Y - TABLE_TOP_THICKNESS / 2 - TABLE_LEG_HEIGHT;

const ROOM_HALF_WIDTH = 22; // comfortably past OrbitControls' maxDistance (16)
const ROOM_HALF_DEPTH = 22;
// Ceiling height is derived from OrbitControls' own envelope, not
// guessed: the highest the camera can ever sit above its target is
// maxDistance * cos(minPolarAngle) = 16 * cos(12°) ≈ 15.65 (target y=0,
// so that's an absolute world Y too) — the camera briefly clipping
// through/above too-low a ceiling at max zoom-out + steep overhead angle
// was caught by checking this arithmetic BEFORE building, the same
// "verify the geometry, don't eyeball it" approach BACKDROP_Y/HIGHLIGHT_Y
// used earlier this session, rather than discovering it via a broken
// screenshot after the fact. 20 leaves several units of margin above that
// 15.65 ceiling.
const ROOM_CEILING_Y = 20;
const ROOM_HEIGHT = ROOM_CEILING_Y - TABLE_FLOOR_Y;
// `side: THREE.DoubleSide` on every room-shell material (not BackSide):
// this file already hit the "wrong side invisible" bug once this session
// (PawnMesh's LatheGeometry body reading as hollow under the angled
// camera) and fixed it with DoubleSide rather than by reasoning out the
// correct winding/normal direction by hand — same call here, since an
// inside-out box's inward faces are exactly the class of geometry that
// mistake hits, and DoubleSide costs nothing meaningful for a handful of
// large low-poly box faces.
const WALL_COLOR = "#d8d2c4"; // matches the reference scene's own wall tone
const CEILING_COLOR = "#e4dfd2";
const ROOM_FLOOR_COLOR = "#8f887e";

// Per direct instruction: each player's own color faces them locally by
// default, and dragging the board rotates it independently of the
// camera, snapping to 0/90/180/270. Y-rotation (radians) that brings
// each color's own base quadrant to the "near" side of the screen
// (closest to the default camera — BLUE's own quadrant already sits
// there at zero rotation, per BASE_AREA's world-space mapping in
// PawnMesh/ActiveHighlightFrame below). Starting values — like every
// other 3D orientation constant in this file, verified live via
// screenshot once built, not trusted from hand-derived trig alone (a
// wrong sign here puts a color exactly opposite where intended).
const HOME_ROTATION: Record<PlayerColor, number> = {
  blue: 0,
  yellow: Math.PI / 2,
  red: Math.PI,
  green: -Math.PI / 2,
};

// Eases `current` toward `target` by `factor` each call, always going the
// SHORT way around the circle (350°->0° moves +10°, not the long way
// through 180°) — plain linear interpolation on raw radians doesn't have
// this property and would occasionally spin the board the long way
// around after a Follow Turn jump.
function lerpAngle(current: number, target: number, factor: number): number {
  const twoPi = Math.PI * 2;
  let delta = (target - current) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return current + delta * factor;
}

function nearestQuarterTurn(angle: number): number {
  const quarter = Math.PI / 2;
  return Math.round(angle / quarter) * quarter;
}

// Radians of board rotation per pixel of horizontal drag — tuned so a
// natural swipe across the board rotates it roughly a quarter turn, not
// a barely-perceptible nudge or a dizzying multi-spin. Starting value,
// tuned visually like the rest of this file's constants.
const DRAG_ROTATION_SENSITIVITY = 0.004;

interface BoardScene3DProps {
  svgWrapperRef: RefObject<HTMLDivElement | null>;
  activeColor: PlayerColor | null;
  // The LOCAL viewer's own color — drives the one-time default board
  // orientation (their own base faces them) — deliberately NOT read by
  // any game-logic path; this file is the only place it's ever used for
  // anything besides rotating a purely visual group.
  myColor: PlayerColor | null;
  // "Follow Turn" and the drag-disables-it interaction both live as
  // ordinary React state one level up (MatchArena.tsx, alongside the
  // existing Sound/Auto-Roll toggles) — this component only reads the
  // current value and reports drags back up via onDragBoard, it doesn't
  // own the toggle itself.
  followTurn: boolean;
  onDragBoard: () => void;
  pawns: readonly Pawn[];
  legalPawnIds: ReadonlySet<string>;
  anchorsRef: RefObject<Map<string, HTMLElement>>;
  containerRef: RefObject<HTMLDivElement | null>;
  onSelectPawn: (pawnId: string) => void;
}

export function BoardScene3D({
  svgWrapperRef,
  activeColor,
  myColor,
  followTurn,
  onDragBoard,
  pawns,
  legalPawnIds,
  anchorsRef,
  containerRef,
  onSelectPawn,
}: BoardScene3DProps) {
  const boardTexture = useBoardTexture(svgWrapperRef);
  const woodTexture = useWoodTexture();
  const floorTexture = useFloorTexture();
  // Built once and shared by every pawn regardless of color — only the
  // material differs per pawn, never the shape.
  const bodyGeometry = useMemo(() => new THREE.LatheGeometry(buildBodyProfile(), 48), []);
  const ringGeometry = useMemo(() => new THREE.TorusGeometry(RING_RADIUS, RING_TUBE_RADIUS, 12, 48), []);

  // The board's own rotation group — wraps the slab, active-turn
  // highlights, and every pawn (NOT the room/table/lights/camera, which
  // must never rotate). Driven imperatively every frame from refs, the
  // same convention this file already uses for ActiveHighlightFrame's
  // pulse and PawnMesh's position — never via setState per frame.
  const boardGroupRef = useRef<THREE.Group>(null);
  const liveRotationRef = useRef(0);
  const snapTargetRef = useRef(0);
  const hasSetDefaultRotationRef = useRef(false);
  const dragStateRef = useRef<{ startClientX: number; startRotation: number } | null>(null);
  // The one piece of this that IS React state: it also flips
  // OrbitControls' own `enabled` prop off for the duration of a board
  // drag (per direct instruction — camera and board rotation must never
  // fight over the same gesture), which needs a real render to take
  // effect. Everything else about a drag is ref-only.
  const [isDraggingBoard, setIsDraggingBoard] = useState(false);

  // Each player's own color faces them by default — set once, the first
  // time myColor is actually known (a ref guard, not a [myColor] value
  // check alone, so this can never re-fire and silently overwrite a
  // later manual drag or Follow Turn rotation).
  useEffect(() => {
    if (hasSetDefaultRotationRef.current || !myColor) return;
    hasSetDefaultRotationRef.current = true;
    const home = HOME_ROTATION[myColor];
    liveRotationRef.current = home;
    snapTargetRef.current = home;
    if (boardGroupRef.current) boardGroupRef.current.rotation.y = home;
  }, [myColor]);

  // Follow Turn: ease toward whoever's turn it currently is, only while
  // the toggle is on. A null activeColor (lobby/summary states) leaves
  // the board wherever it already was instead of snapping to anything.
  useEffect(() => {
    if (!followTurn || !activeColor) return;
    snapTargetRef.current = HOME_ROTATION[activeColor];
  }, [followTurn, activeColor]);

  // Attached to BoardSlab's own mesh below (its wood-framed edges AND
  // its printed top face — the board's whole physical surface counts as
  // "the board" for this gesture, not just a thin edge ring) — per
  // direct instruction, dragging the board rotates it, independent of
  // the camera, disabling OrbitControls for the duration. Deliberately a
  // plain `window` pointermove/pointerup pair (added on pointerdown,
  // removed on pointerup) rather than routing through r3f's own pointer
  // events for the move/up phase: r3f's synthetic event system and
  // OrbitControls' native DOM listeners are two separate systems this
  // file has already hit a real conflict between once (PawnScene3D's
  // pointer-events bug, earlier this session) — a plain window listener
  // sidesteps that class of bug entirely instead of risking it again.
  //
  // No new hit-target geometry needed for the "Game Piece > Board
  // Controls > Environment" priority the spec asks for: pawns are
  // separate meshes sitting closer to the camera than the slab, so r3f's
  // own closest-hit-first raycasting already resolves a pawn click
  // before it ever reaches this handler, and anything that misses the
  // slab's footprint entirely falls through to OrbitControls untouched
  // — both for free, from normal 3D depth ordering.
  function handleBoardPointerDown(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    onDragBoard();
    setIsDraggingBoard(true);
    dragStateRef.current = { startClientX: event.clientX, startRotation: liveRotationRef.current };

    function handlePointerMove(moveEvent: PointerEvent) {
      const drag = dragStateRef.current;
      if (!drag) return;
      liveRotationRef.current = drag.startRotation + (moveEvent.clientX - drag.startClientX) * DRAG_ROTATION_SENSITIVITY;
    }
    function handlePointerUp() {
      dragStateRef.current = null;
      snapTargetRef.current = nearestQuarterTurn(liveRotationRef.current);
      setIsDraggingBoard(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handleBoardPointerOver() {
    document.body.style.cursor = "grab";
  }

  function handleBoardPointerOut() {
    if (!dragStateRef.current) document.body.style.cursor = "auto";
  }

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
          enabled={!isDraggingBoard}
          target={[0, 0, 2.2]}
          enablePan={false}
          minDistance={5}
          maxDistance={16}
          minPolarAngle={THREE.MathUtils.degToRad(12)}
          maxPolarAngle={THREE.MathUtils.degToRad(82)}
        />
        <ambientLight intensity={0.85} />
        {/* Cheap sky/ground gradient fill across the room's now much
            larger walls/floor — standard, inexpensive, and (unlike the
            reference file's PMREMGenerator environment) not implicated in
            any known rendering bug. Kept alongside, not instead of, the
            existing ambient/directional lights below, which already read
            correctly on the board/pawns. */}
        <hemisphereLight args={["#fdf3e2", "#3a332a", 0.5]} />
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
        <RoomShell floorTexture={floorTexture} />
        <CoffeeTable woodTexture={woodTexture} />
        <Rug />
        <Sofa />
        <FloorLamp />
        <ContactShadows
          position={[0, -SLAB_DEPTH - 0.001, 0]}
          opacity={0.5}
          scale={BOARD_SIZE * 1.7}
          blur={1.8}
          far={3}
          resolution={512}
          color="#1a140d"
        />
        {/* useFrame only works on a descendant of <Canvas> — BoardScene3D
            itself (the component that RENDERS this <Canvas>) is not one,
            so the per-frame lerp lives in this tiny renderless child
            instead of inline above. */}
        <BoardRotationDriver
          boardGroupRef={boardGroupRef}
          liveRotationRef={liveRotationRef}
          snapTargetRef={snapTargetRef}
          isDraggingBoard={isDraggingBoard}
        />
        {/* Everything that's part of "the board" (slab, active-turn
            highlights, pawns) lives inside this one rotating group — the
            room, table backdrop, lights, shadow catcher, and camera all
            stay outside it and never rotate. */}
        <group ref={boardGroupRef}>
          {boardTexture && (
            <BoardSlab
              boardTexture={boardTexture}
              woodTexture={woodTexture}
              onPointerDown={handleBoardPointerDown}
              onPointerOver={handleBoardPointerOver}
              onPointerOut={handleBoardPointerOut}
            />
          )}
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
        </group>
      </Canvas>
    </div>
  );
}

// Renderless — exists purely so the per-frame rotation lerp can call
// useFrame from inside the <Canvas> tree (see the comment at its call
// site above). Mutates the same refs BoardScene3D owns; isDraggingBoard
// is read fresh each render since r3f re-subscribes the callback whenever
// this component re-renders.
function BoardRotationDriver({
  boardGroupRef,
  liveRotationRef,
  snapTargetRef,
  isDraggingBoard,
}: {
  boardGroupRef: RefObject<THREE.Group | null>;
  liveRotationRef: RefObject<number>;
  snapTargetRef: RefObject<number>;
  isDraggingBoard: boolean;
}) {
  useFrame(() => {
    const group = boardGroupRef.current;
    if (!group) return;
    if (!isDraggingBoard) {
      liveRotationRef.current = lerpAngle(liveRotationRef.current, snapTargetRef.current, 0.18);
    }
    group.rotation.y = liveRotationRef.current;
  });
  return null;
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

// A tileable speckled floor texture, canvas-generated (same technique as
// the reference file's makeConcreteFloorTexture: fill + scattered soft
// radial blotches + fine speckle noise, rasterized once to a canvas and
// wrapped as a RepeatWrapping CanvasTexture) rather than a flat color —
// cheap, no new image asset, and reads far better than a flat plane across
// a floor this large. Built inside a useEffect (not useMemo): the
// react-hooks/purity lint rule this project runs flags Math.random calls
// reached during render, including inside a useMemo callback (useMemo's
// callback still runs synchronously DURING render) — an effect runs after
// render as an intentional side effect, which the rule doesn't flag, so
// this follows the same useEffect+useState shape as useBoardTexture/
// useWoodTexture above rather than fighting the linter over it. The
// `setTexture` call is wrapped in `queueMicrotask` rather than called
// synchronously at the end of the effect body — this project's
// react-hooks/set-state-in-effect rule flags a same-tick setState inside
// an effect (cascading-render risk) and only allows it from an async
// callback, exactly like the image `onload` callbacks useBoardTexture/
// useWoodTexture already defer through; a microtask is the equivalent
// deferral for this synchronous canvas computation, which has no image
// load of its own to await.
function useFloorTexture(): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const size = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = ROOM_FLOOR_COLOR;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 260; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 14 + Math.random() * 70;
        const shade = 90 + Math.random() * 70;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(${shade},${shade - 8},${shade - 16},${0.08 + Math.random() * 0.1})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      const imgData = ctx.getImageData(0, 0, size, size);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 10;
        d[i] += n;
        d[i + 1] += n;
        d[i + 2] += n;
      }
      ctx.putImageData(imgData, 0, 0);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(9, 9);
    tex.needsUpdate = true;
    queueMicrotask(() => setTexture(tex));
  }, []);

  return texture;
}

// The enclosed room itself — one inside-out box (see the constants' own
// comment for why a single box beats 5 separate planes) spanning well
// past OrbitControls' own orbit/zoom envelope, so no camera angle at full
// 360° orbit ever shows a gap, edge, or void the way the old flat photo
// backdrop eventually did. Box face order is [+x, -x, +y, -y, +z, -z] —
// same convention BoardSlab already uses below (index 2 = ceiling, index
// 3 = floor).
function RoomShell({ floorTexture }: { floorTexture: THREE.CanvasTexture | null }) {
  const wallMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.92, side: THREE.DoubleSide }),
    [],
  );
  const ceilingMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: CEILING_COLOR, roughness: 0.85, side: THREE.DoubleSide }),
    [],
  );
  // Plain color fallback for the one frame (if any) before the floor
  // texture's effect has run — same "never render with a null map" care
  // BoardSlab's own edgeMaterial takes for woodTexture below.
  const floorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: floorTexture ? "#ffffff" : ROOM_FLOOR_COLOR,
        map: floorTexture,
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    [floorTexture],
  );
  const materials = useMemo(
    () => [wallMaterial, wallMaterial, ceilingMaterial, floorMaterial, wallMaterial, wallMaterial],
    [wallMaterial, ceilingMaterial, floorMaterial],
  );

  return (
    // key: same material-recompile fix BoardSlab already relies on — a
    // material first compiled with `map: null` (the one frame before the
    // floor texture's effect resolves) never picks up a later-assigned
    // texture without a fresh mount, so swap key once the real texture
    // exists rather than trust an in-place `.map` update in a WebGL
    // fallback path this file hasn't otherwise needed to trust.
    <mesh
      key={floorTexture ? "floor-photo" : "floor-fallback"}
      position={[0, (ROOM_CEILING_Y + TABLE_FLOOR_Y) / 2, 0]}
      material={materials}
      receiveShadow
    >
      <boxGeometry args={[ROOM_HALF_WIDTH * 2, ROOM_HEIGHT, ROOM_HALF_DEPTH * 2]} />
    </mesh>
  );
}

// The table the board actually sits on — replaces the old backdrop
// photo's own (now-gone) table. Reuses the SAME wood photo already loaded
// for the board's own frame (useWoodTexture) rather than a new asset, for
// a consistent wood tone between board and table.
function CoffeeTable({ woodTexture }: { woodTexture: THREE.CanvasTexture | null }) {
  const topMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: woodTexture ? "#ffffff" : "#6b4a2e",
        map: woodTexture,
        roughness: 0.45,
        metalness: 0.04,
      }),
    [woodTexture],
  );
  const legMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#241f1a", roughness: 0.5 }), []);
  const legInset = 0.5;
  const legPositions: Array<[number, number]> = [
    [TABLE_TOP_WIDTH / 2 - legInset, TABLE_TOP_DEPTH / 2 - legInset],
    [-(TABLE_TOP_WIDTH / 2 - legInset), TABLE_TOP_DEPTH / 2 - legInset],
    [TABLE_TOP_WIDTH / 2 - legInset, -(TABLE_TOP_DEPTH / 2 - legInset)],
    [-(TABLE_TOP_WIDTH / 2 - legInset), -(TABLE_TOP_DEPTH / 2 - legInset)],
  ];

  return (
    <group>
      <mesh key={woodTexture ? "wood-photo" : "wood-fallback"} position={[0, TABLE_TOP_Y, 0]} material={topMaterial} castShadow receiveShadow>
        <boxGeometry args={[TABLE_TOP_WIDTH, TABLE_TOP_THICKNESS, TABLE_TOP_DEPTH]} />
      </mesh>
      {legPositions.map(([x, z]) => (
        <mesh
          key={`${x}-${z}`}
          position={[x, TABLE_TOP_Y - TABLE_TOP_THICKNESS / 2 - TABLE_LEG_HEIGHT / 2, z]}
          material={legMaterial}
          castShadow
        >
          <boxGeometry args={[0.28, TABLE_LEG_HEIGHT, 0.28]} />
        </mesh>
      ))}
    </group>
  );
}

// A low oval rug under the table, same cheap-speckle canvas-texture
// technique as the floor — mostly there so the floor immediately around
// the table doesn't read as one uniform material out to the walls.
function Rug() {
  // useEffect, not useMemo — see useFloorTexture's own comment on why
  // Math.random can't run during render under this project's
  // react-hooks/purity rule.
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#c7c2b6";
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 3000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const shade = 190 + Math.random() * 50;
        ctx.strokeStyle = `rgba(${shade},${shade - 4},${shade - 10},${0.08 + Math.random() * 0.12})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 5, y + (Math.random() - 0.5) * 5);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // See useFloorTexture's own comment on why this is deferred to a
    // microtask rather than called synchronously at the end of the effect.
    queueMicrotask(() => setTexture(tex));
  }, []);

  if (!texture) return null;

  return <RugMesh texture={texture} />;
}

function RugMesh({ texture }: { texture: THREE.CanvasTexture }) {
  const material = useMemo(() => new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }), [texture]);

  return (
    <mesh position={[0, TABLE_FLOOR_Y + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={material} receiveShadow>
      <circleGeometry args={[TABLE_TOP_WIDTH * 1.6, 48]} />
    </mesh>
  );
}

// A low, simple stacked-box sofa (same construction technique as the
// reference scene's makeSofa, trimmed to a single straight bench rather
// than its full L-shaped sectional) — placed behind the table purely for
// atmosphere/scale, well outside the board's own play area.
function Sofa() {
  const fabricMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#e7ddc9", roughness: 0.9 }), []);
  const seatHeight = 0.9;
  const backHeight = 1.1;
  const sofaZ = -(ROOM_HALF_DEPTH - 3.5);

  return (
    <group position={[0, TABLE_FLOOR_Y, sofaZ]}>
      <mesh position={[0, seatHeight / 2, 0]} material={fabricMaterial} castShadow receiveShadow>
        <boxGeometry args={[6.5, seatHeight, 2.2]} />
      </mesh>
      <mesh position={[0, (seatHeight + backHeight) / 2, -1.1]} material={fabricMaterial} castShadow>
        <boxGeometry args={[6.5, seatHeight + backHeight, 0.5]} />
      </mesh>
    </group>
  );
}

// A single floor lamp with its own small warm point light — the only new
// light source this pass adds beyond the existing proven ambient/
// directional/hemisphere combo, kept modest (short range, low intensity)
// so it reads as a secondary accent rather than competing with the key
// light already lighting the board itself.
function FloorLamp() {
  const poleMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#241f1a", roughness: 0.4 }), []);
  const shadeMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#f3e6c9", roughness: 0.8, emissive: "#ffdca0", emissiveIntensity: 0.3 }),
    [],
  );
  const x = ROOM_HALF_WIDTH - 4;
  const z = -1.5;

  return (
    <group position={[x, TABLE_FLOOR_Y, z]}>
      <mesh position={[0, 1.6, 0]} material={poleMaterial} castShadow>
        <cylinderGeometry args={[0.04, 0.04, 3.2, 10]} />
      </mesh>
      <mesh position={[0, 3.3, 0]} material={shadeMaterial}>
        <cylinderGeometry args={[0.35, 0.45, 0.6, 20, 1, true]} />
      </mesh>
      <pointLight position={[0, 3.2, 0]} color="#ffcf8a" intensity={0.6} distance={7} decay={2} />
    </group>
  );
}

// The board as a real slab with depth, top face at local/world y=0 (where
// pawns rest) and extending down toward the table.
function BoardSlab({
  boardTexture,
  woodTexture,
  onPointerDown,
  onPointerOver,
  onPointerOut,
}: {
  boardTexture: THREE.CanvasTexture;
  woodTexture: THREE.CanvasTexture | null;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOver: () => void;
  onPointerOut: () => void;
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
    <mesh
      key={woodTexture ? "wood-photo" : "wood-fallback"}
      position={[0, -SLAB_DEPTH / 2, 0]}
      material={materials}
      receiveShadow
      onPointerDown={onPointerDown}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
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
