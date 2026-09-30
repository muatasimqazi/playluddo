import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOARD_4, BOARD_6, boardSpecForPawns } from "../../lib/board/boardSpec";
import { deriveStateFromPathIndex, pathIndexToGlobalCell } from "../../lib/board/geometry";
import type { GameRoomState, Pawn, PlayerColor } from "../../lib/board/types";
import {
  BOARD_Y,
  homeRotation,
  HOME_ROTATION,
  moveWaypoints,
  pawnPoint,
  rotationStep,
} from "../../lib/presentation/board";
import { pieceWhere, routeLength } from "../../lib/presentation/controller";
import { HEX_BOARD_FILE, HEX_BOARD_STYLES, hexBoardSvg } from "../../lib/presentation/hexArtwork";
import { PresentationTimeline } from "../../lib/presentation/timeline";
import {
  HEX_ART_APOTHEM,
  HEX_ART_RADIUS,
  HEX_BASE_RADIUS,
  HEX_CELL,
  HEX_SLAB_APOTHEM,
  hexArmAngle,
  hexBaseCenter,
  hexFinishPoint,
  hexGoalPoint,
  hexHomeLanePoint,
  hexHomeRotation,
  hexNestPoint,
  hexTrackPoint,
  type Vec2,
} from "../../lib/presentation/hexBoard";

const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cells = (a: Vec2, b: Vec2) => distance(a, b) / HEX_CELL;

/** Inside the printed hexagon (edges face the arms at 180deg + k*60deg). */
function insideHexagon([x, z]: Vec2, apothem: number): boolean {
  return Array.from({ length: 6 }, (_, k) => hexArmAngle(k)).every(
    (angle) => x * Math.cos(angle) + z * Math.sin(angle) <= apothem + 1e-9,
  );
}

/**
 * Centre of every element with an id in an SVG: a rect's middle or a
 * circle's centre, through its own transform. Handles translate, rotate,
 * scale and matrix — what design tools write on export — but not transforms
 * on enclosing groups, so keep the pinned elements ungrouped.
 */
function svgAnchors(svg: string): Map<string, Vec2> {
  type M = [number, number, number, number, number, number];
  const mul = (a: M, b: M): M => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const parse = (transform = ""): M => {
    let m: M = [1, 0, 0, 1, 0, 0];
    for (const [, op, args] of transform.matchAll(/(\w+)\(([^)]*)\)/g)) {
      const v = args.trim().split(/[\s,]+/).map(Number);
      let t: M = [1, 0, 0, 1, 0, 0];
      if (op === "translate") t = [1, 0, 0, 1, v[0], v[1] ?? 0];
      else if (op === "scale") t = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
      else if (op === "matrix") t = v as M;
      else if (op === "rotate") {
        const a = (v[0] * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
        const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
        t = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
      }
      m = mul(m, t);
    }
    return m;
  };
  const anchors = new Map<string, Vec2>();
  for (const [tag, tagName] of svg.matchAll(/<(rect|circle|ellipse)\b[^>]*>/g)) {
    const attr = (name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    const id = attr("id");
    if (!id) continue;
    const num = (name: string) => Number(attr(name) ?? 0);
    const [px, py] =
      tagName === "rect"
        ? [num("x") + num("width") / 2, num("y") + num("height") / 2]
        : [num("cx"), num("cy")];
    const m = parse(attr("transform"));
    anchors.set(id, [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]]);
  }
  return anchors;
}

describe("hexagonal board geometry (F5.2)", () => {
  const ring = Array.from({ length: BOARD_6.trackLength }, (_, cell) => hexTrackPoint(cell));

  it("lays the 78 shared cells out as one closed ring of neighbouring cells", () => {
    ring.forEach((point, cell) => {
      const next = ring[(cell + 1) % ring.length];
      const step = cells(point, next);
      // A straight step is one cell; the arm-to-arm step across a hub corner
      // is a little longer, like the cross's diagonal seams.
      expect(step, `step ${cell} -> ${cell + 1}`).toBeGreaterThan(0.99);
      expect(step, `step ${cell} -> ${cell + 1}`).toBeLessThan(1.4);
    });
  });

  it("never overlaps two cells — track, home columns or hub", () => {
    const home = BOARD_6.colors.flatMap((color) =>
      Array.from({ length: 5 }, (_, i) => hexHomeLanePoint(color, i)),
    );
    const all = [...ring, ...home];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(cells(all[i], all[j]), `cells ${i} and ${j}`).toBeGreaterThan(0.99);
      }
    }
  });

  it("keeps every printed feature inside the hexagon, and the bases off the track", () => {
    for (const point of ring) expect(insideHexagon(point, HEX_ART_APOTHEM - HEX_CELL / 2)).toBe(true);
    for (const color of BOARD_6.colors) {
      const base = hexBaseCenter(color);
      expect(insideHexagon(base, HEX_ART_APOTHEM - HEX_BASE_RADIUS)).toBe(true);
      for (const cell of ring) {
        // Base disc edge to cell centre, clear of half a cell's diagonal.
        expect(distance(base, cell) - HEX_BASE_RADIUS).toBeGreaterThan(HEX_CELL * 0.5);
      }
      const slots = Array.from({ length: 4 }, (_, i) => hexNestPoint(color, i));
      for (const slot of slots) expect(distance(slot, base)).toBeLessThan(HEX_BASE_RADIUS);
      expect(new Set(slots.map(([x, z]) => `${x}:${z}`)).size).toBe(4);
    }
    expect(HEX_SLAB_APOTHEM).toBeGreaterThan(HEX_ART_APOTHEM);
  });

  it("puts each colour's entry on its own arm beside its own base", () => {
    for (const color of BOARD_6.colors) {
      const entry = hexTrackPoint(pathIndexToGlobalCell(color, 0, BOARD_6));
      const others = BOARD_6.colors.filter((c) => c !== color);
      const own = distance(entry, hexBaseCenter(color));
      for (const other of others) expect(own).toBeLessThan(distance(entry, hexBaseCenter(other)));
    }
  });

  it("runs each home column from beside the colour's last shared cell into the hub", () => {
    for (const color of BOARD_6.colors) {
      const last = hexTrackPoint(
        pathIndexToGlobalCell(color, BOARD_6.pathIndex.LAST_TRACK_CELL, BOARD_6),
      );
      const lane = Array.from({ length: 5 }, (_, i) => hexHomeLanePoint(color, i));
      expect(cells(last, lane[0])).toBeCloseTo(1, 6);
      for (let i = 1; i < lane.length; i++) expect(cells(lane[i - 1], lane[i])).toBeCloseTo(1, 6);
      // Each step goes inwards, ending just outside the hub goal.
      const radii = lane.map(([x, z]) => Math.hypot(x, z));
      for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1]);
      expect(Math.hypot(...hexGoalPoint(color))).toBeLessThan(radii[4]);
    }
  });

  it("turns each colour's home column to the near edge", () => {
    for (const color of BOARD_6.colors) {
      const [x, z] = hexHomeLanePoint(color, 0);
      const angle = hexHomeRotation(color);
      // Same convention as board.ts's HOME_ROTATION test for the cross.
      expect(-x * Math.sin(angle) + z * Math.cos(angle)).toBeGreaterThan(2);
    }
  });

  it("gives finished pawns separate table slots off the board", () => {
    for (const color of BOARD_6.colors) {
      const slots = Array.from({ length: 4 }, (_, i) => hexFinishPoint(color, i));
      expect(new Set(slots.map(([x, z]) => `${x}:${z}`)).size).toBe(4);
      for (const slot of slots) expect(insideHexagon(slot, HEX_SLAB_APOTHEM)).toBe(false);
      for (const slot of slots) expect(Math.hypot(...slot)).toBeGreaterThan(HEX_ART_RADIUS);
    }
  });

  it.each(HEX_BOARD_STYLES)("prints a well-formed %s board with one anchor per cell, base and slot", (style) => {
    const svg = hexBoardSvg(style);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined/);
    // 78 track + 30 home cells, 6 bases, 24 nest slots, and nothing else by id.
    expect(svg.match(/\sid="(track|home|base|nest)-/g)).toHaveLength(78 + 30 + 6 + 24);
    expect(new Set(svg.match(/\sid="[^"]+"/g)).size).toBe(svg.match(/\sid="[^"]+"/g)!.length);
  });

  it.each(HEX_BOARD_STYLES)(
    "keeps the committed %s board's cells, bases and nest slots where the pawns go",
    (style) => {
      // The files may be restyled by hand; only what a pawn lands on is pinned.
      const file = `designs/${HEX_BOARD_FILE[style]}`;
      const svg = readFileSync(join(__dirname, "../..", file), "utf8");
      const r = HEX_ART_RADIUS;
      const box = svg.match(/<svg\b[^>]*\bviewBox="([^"]+)"/)?.[1].trim().split(/[\s,]+/).map(Number);
      expect(box, `${file}: keep the viewBox, the scene maps it onto the hexagon`).toEqual([
        expect.closeTo(-r, 3),
        expect.closeTo(-r, 3),
        expect.closeTo(2 * r, 3),
        expect.closeTo(2 * r, 3),
      ]);
      const anchors = svgAnchors(svg);
      const expected: [string, Vec2][] = [
        ...ring.map((point, cell): [string, Vec2] => [`track-${cell}`, point]),
        ...BOARD_6.colors.flatMap((color): [string, Vec2][] => [
          [`base-${color}`, hexBaseCenter(color)],
          ...Array.from({ length: 5 }, (_, i): [string, Vec2] => [`home-${color}-${i}`, hexHomeLanePoint(color, i)]),
          ...Array.from({ length: 4 }, (_, i): [string, Vec2] => [`nest-${color}-${i}`, hexNestPoint(color, i)]),
        ]),
      ];
      for (const [id, [x, z]] of expected) {
        const found = anchors.get(id);
        expect(found, `${file} is missing #${id}`).toBeDefined();
        // Within 3% of a cell: invisible, but catches a moved or rescaled print.
        expect(Math.hypot(found![0] - x, found![1] - z), `${file}: #${id} has moved`).toBeLessThan(
          HEX_CELL * 0.03,
        );
      }
    },
  );
});

function hexPawn(color: PlayerColor, pathIndex: number | null, index = 0): Pawn {
  return {
    id: `${color}-${index}`,
    color,
    index,
    pathIndex,
    state: deriveStateFromPathIndex(pathIndex, BOARD_6),
  };
}

/** Every seat's pawns in base, with the given ones placed. */
function hexTable(...placed: Pawn[]): Pawn[] {
  return BOARD_6.colors.flatMap((color) =>
    Array.from(
      { length: 4 },
      (_, index) =>
        placed.find((p) => p.id === `${color}-${index}`) ?? hexPawn(color, null, index),
    ),
  );
}

describe("the hexagon in the presentation layer (F5.2)", () => {
  afterEach(() => vi.useRealTimers());

  it("recognises the board from its seat colours", () => {
    expect(boardSpecForPawns(hexTable())).toBe(BOARD_6);
    expect(boardSpecForPawns([hexPawn("red", 0), hexPawn("yellow", 0)])).toBe(BOARD_4);
  });

  it("places pawns on the printed hex cells", () => {
    const pawn = hexPawn("black", 15);
    const [x, z] = hexTrackPoint(pathIndexToGlobalCell("black", 15, BOARD_6));
    expect(pawnPoint(pawn, "ludo", BOARD_6)).toEqual([x, BOARD_Y, z]);
    // pathIndex 79 is home-column cell 2 (the column starts at 77).
    const [hx, hz] = hexHomeLanePoint("orange", 2);
    expect(pawnPoint(hexPawn("orange", 79), "ludo", BOARD_6)).toEqual([hx, BOARD_Y, hz]);
    const [nx, nz] = hexNestPoint("green", 3);
    expect(pawnPoint(hexPawn("green", null, 3), "ludo", BOARD_6)).toEqual([nx, BOARD_Y, nz]);
  });

  it("walks every cell into the home column, then touches the hub before the tray", () => {
    for (const color of BOARD_6.colors) {
      const path = moveWaypoints(hexPawn(color, 74), hexPawn(color, 80), "ludo", null, BOARD_6);
      expect(path).toHaveLength(6);
      path.forEach((point, i) =>
        expect(point).toEqual(pawnPoint(hexPawn(color, 75 + i), "ludo", BOARD_6)),
      );
    }
    const finish = moveWaypoints(hexPawn("blue", 81), hexPawn("blue", 82), "ludo", null, BOARD_6);
    expect(finish).toHaveLength(2);
    const [gx, gz] = hexGoalPoint("blue");
    expect(finish[0]).toEqual([gx, BOARD_Y, gz]);
    expect(finish[1]).toEqual(pawnPoint(hexPawn("blue", 82), "ludo", BOARD_6));
  });

  it("turns in sixths on the hexagon and keeps the cross's own angles", () => {
    expect(rotationStep(BOARD_6)).toBeCloseTo(Math.PI / 3);
    expect(rotationStep(BOARD_4)).toBeCloseTo(Math.PI / 2);
    for (const color of ["red", "green", "yellow", "blue"] as const)
      expect(homeRotation(color, BOARD_4)).toBe(HOME_ROTATION[color]);
    // Red points the same way on both boards; the others differ.
    expect(homeRotation("red", BOARD_6)).toBeCloseTo(HOME_ROTATION.red);
    expect(homeRotation("green", BOARD_6)).not.toBeCloseTo(HOME_ROTATION.green);
  });

  it("gives the party controller the hexagon's route", () => {
    const state = { gameType: "ludo" as const, pawns: hexTable() };
    expect(routeLength(state)).toBe(83);
    expect(pieceWhere(state, hexPawn("black", 13))).toBe("69 to go · safe on a star");
    expect(pieceWhere(state, hexPawn("black", 79))).toBe("Home column · 3 to go");
  });

  it("plays a move across the hex wrap seam onto the right cell", () => {
    vi.useFakeTimers();
    const pawns = hexTable(hexPawn("black", 14));
    const state = {
      gameType: "ludo",
      eventSequence: 0,
      activeDiceValue: 1,
      pawns,
      players: [],
    } as unknown as GameRoomState;
    const timeline = new PresentationTimeline(state);
    // black pathIndex 14 -> 15 is global cell (65 + 15) mod 78 = 2. Decoded
    // with the cross's 52 cells it would land on pathIndex -11.
    timeline.receive(
      [
        {
          id: 1,
          sequence: 1,
          event_type: "legal_move_selected",
          player_id: "p-black",
          payload: {
            pawnId: "black-0",
            fromTileId: "track:1",
            toTileId: "track:2",
            capturesPawnIds: [],
            finishesPawn: false,
          },
          created_at: "",
        },
      ],
      { ...state, eventSequence: 1 },
    );
    const moved = timeline.getSnapshot().pawns.find((p) => p.id === "black-0");
    expect(moved).toMatchObject({ pathIndex: 15, state: "track" });
    timeline.dispose();
  });
});

describe("hexagon camera framing", () => {
  it("keeps the whole hex slab in the three main views, however the board is turned", async () => {
    const { PerspectiveCamera, Vector3 } = await import("three");
    const { cameraFraming } = await import("../../lib/presentation/camera");
    // The slab's corners, at every angle the board can be turned to.
    const reach = HEX_SLAB_APOTHEM / Math.cos(Math.PI / 6);
    for (const aspect of [390 / 844, 393 / 852, 768 / 1024, 1440 / 900]) {
      for (const view of ["play", "overhead", "table"] as const) {
        const { eye, target, fov } = cameraFraming(view, aspect);
        const camera = new PerspectiveCamera(fov, aspect, 0.1, 120);
        camera.position.set(...eye);
        camera.lookAt(...target);
        camera.updateMatrixWorld();
        for (let degree = 0; degree < 360; degree += 3) {
          const angle = (degree * Math.PI) / 180;
          const projected = new Vector3(
            Math.cos(angle) * reach,
            BOARD_Y,
            Math.sin(angle) * reach,
          ).project(camera);
          expect(Math.abs(projected.x), `${view} ${aspect} ${degree}deg`).toBeLessThan(1);
          expect(Math.abs(projected.y), `${view} ${aspect} ${degree}deg`).toBeLessThan(1);
        }
      }
    }
  });
});
