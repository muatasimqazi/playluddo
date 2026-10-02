import { BOARD_6 } from "../board/boardSpec";
import type { PlayerColor } from "../board/types";
import {
  HEX_ART_RADIUS,
  HEX_BASE_RADIUS,
  HEX_CELL,
  HEX_HUB_APOTHEM,
  HEX_HUB_CORNER,
  hexArmAngle,
  hexBaseAngle,
  hexBaseCenter,
  hexHomeLanePoint,
  hexNestPoint,
  hexPolar,
  hexTipPoint,
  hexTrackPoint,
  hexTrackSegment,
  type Vec2,
} from "./hexBoard";

/**
 * The printed 5-6 player hexagonal boards (docs/COMPETITIVE_ROADMAP.md F5.2),
 * one per board style, matching the square boards in designs/:
 *
 *   classic   -> designs/board-hex-classic.svg    (board-classic.svg)
 *   signature -> designs/board-hex-signature.svg  (board-design.webp)
 *   geometric -> designs/board-hex-geometric.svg  (board-geometric.svg)
 *   aladdin   -> designs/board-hex-aladdin.svg    (board-aladdin.svg)
 *   bazaar    -> designs/board-hex-bazaar.svg     (board-bazaar.svg)
 *   rug       -> designs/board-hex-rug.svg        (board-rug.svg)
 *   mosaic    -> designs/board-hex-mosaic.svg     (board-mosaic.svg)
 *
 * Written by `npm run board:hex`, then free to restyle by hand. Every style
 * draws the same anchors — the track cells, home columns, bases and nest
 * slots, by id — through anchorCell/anchorCircle below, at the positions
 * lib/presentation/hexBoard.ts places pawns on; a theme only styles them and
 * decorates around them. tests/presentation/hexBoard.test.ts holds every
 * committed file to those positions.
 *
 * Coordinates are board-local world units with SVG y = world z; the viewBox
 * is the square [-HEX_ART_RADIUS, HEX_ART_RADIUS]^2 that SimulatorScene maps
 * onto the hexagonal top face.
 */

export type HexBoardStyle = "classic" | "signature" | "geometric" | "aladdin" | "bazaar" | "rug" | "mosaic";
export const HEX_BOARD_STYLES: readonly HexBoardStyle[] = [
  "classic",
  "signature",
  "geometric",
  "aladdin",
  "bazaar",
  "rug",
  "mosaic",
];
/** File name in designs/ for each style. */
export const HEX_BOARD_FILE: Record<HexBoardStyle, string> = {
  classic: "board-hex-classic.svg",
  signature: "board-hex-signature.svg",
  geometric: "board-hex-geometric.svg",
  aladdin: "board-hex-aladdin.svg",
  bazaar: "board-hex-bazaar.svg",
  rug: "board-hex-rug.svg",
  mosaic: "board-hex-mosaic.svg",
};

// ---------------------------------------------------------------------------
// Shared drawing helpers
// ---------------------------------------------------------------------------

const n = (value: number) => Number(value.toFixed(4));
const deg = (radians: number) => n((radians * 180) / Math.PI);
/** Printed cell size: a hair smaller than the cell so neighbours read apart. */
const SIZE = HEX_CELL * 0.94;
const C = HEX_CELL;

/** A track or home cell pawns stand on: centred on `point`, squared to its arm. */
function anchorCell(id: string, [x, z]: Vec2, arm: number, attrs: string, radius = C * 0.06): string {
  return `<rect id="${id}" x="${n(-SIZE / 2)}" y="${n(-SIZE / 2)}" width="${n(SIZE)}" height="${n(SIZE)}" rx="${n(radius)}" ${attrs} transform="translate(${n(x)} ${n(z)}) rotate(${deg(hexArmAngle(arm))})"/>`;
}

/** A base or nest slot pawns stand on. */
function anchorCircle(id: string, [x, z]: Vec2, r: number, attrs: string): string {
  return `<circle id="${id}" cx="${n(x)}" cy="${n(z)}" r="${n(r)}" ${attrs}/>`;
}

/** Decoration drawn in a cell's own frame: origin at its centre, +x along its arm, outwards. */
function inCell([x, z]: Vec2, arm: number, body: string): string {
  return `<g transform="translate(${n(x)} ${n(z)}) rotate(${deg(hexArmAngle(arm))})">${body}</g>`;
}

/** Decoration drawn around `point`, turned so +x points along `angle`. */
function around([x, z]: Vec2, angle: number, body: string): string {
  return `<g transform="translate(${n(x)} ${n(z)}) rotate(${deg(angle)})">${body}</g>`;
}

/** A `points`-pointed star about the origin, first point along +x turned by `rotation`. */
function star(points: number, outer: number, innerRatio: number, attrs: string, rotation = 0): string {
  const coords = Array.from({ length: points * 2 }, (_, i) => {
    const angle = rotation + (i * Math.PI) / points;
    const r = i % 2 === 0 ? outer : outer * innerRatio;
    return `${n(Math.cos(angle) * r)},${n(Math.sin(angle) * r)}`;
  });
  return `<polygon points="${coords.join(" ")}" ${attrs}/>`;
}

function hexagon(radius: number): string {
  // Corners between the arms (at the bases); edges face the arm tips.
  return Array.from({ length: 6 }, (_, i) => {
    const [x, z] = hexPolar(hexArmAngle(0) + Math.PI / 6 + (i * Math.PI) / 3, radius);
    return `${n(x)},${n(z)}`;
  }).join(" ");
}

function gradient(id: string, stops: readonly string[], radial = false): string {
  const tag = radial ? "radialGradient" : "linearGradient";
  const geometry = radial ? `cx="0.4" cy="0.35" r="0.75"` : `x1="0" y1="0" x2="1" y2="1"`;
  const body = stops
    .map((color, i) => `<stop offset="${n(i / (stops.length - 1))}" stop-color="${color}"/>`)
    .join("");
  return `<${tag} id="${id}" ${geometry}>${body}</${tag}>`;
}

/** The hub triangle an arm's colour finishes in: the centre and the hub edge facing that arm. */
function hubTriangle(arm: number): [Vec2, Vec2] {
  const angle = hexArmAngle(arm);
  return [hexPolar(angle - Math.PI / 6, HEX_HUB_CORNER), hexPolar(angle + Math.PI / 6, HEX_HUB_CORNER)];
}

type CellKind = "plain" | "entry" | "star";

interface Theme {
  defs: string;
  board: string;
  /** Must draw anchorCircle(`base-${color}`, center, HEX_BASE_RADIUS, ...). */
  base(color: PlayerColor, center: Vec2, angle: number): string;
  /** Must draw anchorCircle(`nest-${color}-${index}`, point, ...). */
  nest(color: PlayerColor, index: number, point: Vec2, angle: number): string;
  hub(color: PlayerColor, arm: number): string;
  hubCenter: string;
  /** Must draw anchorCell(`home-${color}-${index}`, point, arm, ...). */
  home(color: PlayerColor, index: number, point: Vec2, arm: number): string;
  /**
   * Must draw anchorCell(`track-${cell}`, point, arm, ...). `kind` is the
   * colour's entry, a safe star (entry + 8), or a plain cell; `owner` is the
   * entering colour for an entry, else the colour of the arm it sits on.
   */
  track(cell: number, point: Vec2, arm: number, kind: CellKind, owner: PlayerColor): string;
  /** The arm's tip: the turn from the shared track into its home column. */
  tip(arm: number, color: PlayerColor): string;
}

// ---------------------------------------------------------------------------
// Classic: flat inks on paper (board-classic.svg)
// ---------------------------------------------------------------------------

const CLASSIC_INK: Record<PlayerColor, string> = {
  red: "#e2262e",
  green: "#31a65b",
  yellow: "#f2c400",
  blue: "#224c9e",
  orange: "#ef7d1a",
  black: "#3b3b46",
};
const CLASSIC_LINE = "#262626";

function chevron(arm: number, fill: string): string {
  const s = C * 0.22;
  // Pointing along -x in the cell's frame: inwards, down the home column.
  return inCell(hexTipPoint(arm), arm, `<polygon points="${n(-s)},0 ${n(s * 0.7)},${n(-s)} ${n(s * 0.7)},${n(s)}" fill="${fill}"/>`);
}

const classic: Theme = {
  defs: "",
  board: `<polygon points="${hexagon(HEX_ART_RADIUS)}" fill="#fbf7ec" stroke="${CLASSIC_LINE}" stroke-width="0.03"/>`,
  base: (color, center) =>
    anchorCircle(`base-${color}`, center, HEX_BASE_RADIUS, `fill="${CLASSIC_INK[color]}" stroke="${CLASSIC_LINE}" stroke-width="0.015"`) +
    `<circle cx="${n(center[0])}" cy="${n(center[1])}" r="${n(HEX_BASE_RADIUS * 0.8)}" fill="#ffffff"/>`,
  nest: (color, index, point) =>
    anchorCircle(`nest-${color}-${index}`, point, C * 0.6, `fill="${CLASSIC_INK[color]}" stroke="${CLASSIC_LINE}" stroke-width="0.01"`),
  hub: (color, arm) => {
    const [a, b] = hubTriangle(arm);
    return `<polygon points="0,0 ${n(a[0])},${n(a[1])} ${n(b[0])},${n(b[1])}" fill="${CLASSIC_INK[color]}" stroke="${CLASSIC_LINE}" stroke-width="0.012"/>`;
  },
  hubCenter: "",
  home: (color, index, point, arm) =>
    anchorCell(`home-${color}-${index}`, point, arm, `fill="${CLASSIC_INK[color]}" stroke="${CLASSIC_LINE}" stroke-width="0.011"`),
  track: (cell, point, arm, kind, owner) =>
    anchorCell(`track-${cell}`, point, arm, `fill="${kind === "entry" ? CLASSIC_INK[owner] : "#ffffff"}" stroke="${CLASSIC_LINE}" stroke-width="0.011"`) +
    (kind === "star"
      ? around(point, -Math.PI / 2, star(5, C * 0.36, 0.45, `fill="${CLASSIC_INK[owner]}"`))
      : ""),
  tip: (arm, color) => chevron(arm, CLASSIC_INK[color]),
};

// ---------------------------------------------------------------------------
// Signature: bright flat inks, white star badges, feathered arrows
// (the Luddo House artwork, board-design.webp)
// ---------------------------------------------------------------------------

const SIGNATURE_INK: Record<PlayerColor, string> = {
  red: "#d0232b",
  green: "#72b865",
  yellow: "#f1df24",
  blue: "#2e3192",
  orange: "#f2891f",
  black: "#34343f",
};

/** A white disc holding a coloured star — the signature board's badge. */
function signatureBadge(ink: string, radius: number): string {
  return `<circle r="${n(radius)}" fill="#ffffff"/>` + star(5, radius * 0.8, 0.42, `fill="${ink}"`, -Math.PI / 2);
}

/** A feathered arrow pointing along -x, drawn in a cell's frame. */
function featheredArrow(ink: string): string {
  const s = SIZE / 2;
  const stroke = `stroke="${ink}" stroke-width="${n(C * 0.06)}" stroke-linecap="round" fill="none"`;
  return (
    `<line x1="${n(s * 0.7)}" y1="0" x2="${n(-s * 0.45)}" y2="0" ${stroke}/>` +
    `<polygon points="${n(-s * 0.75)},0 ${n(-s * 0.3)},${n(-s * 0.3)} ${n(-s * 0.3)},${n(s * 0.3)}" fill="${ink}"/>` +
    [0.35, 0.6]
      .map(
        (at) =>
          `<polyline points="${n(s * (at + 0.22))},${n(-s * 0.25)} ${n(s * at)},0 ${n(s * (at + 0.22))},${n(s * 0.25)}" ${stroke}/>`,
      )
      .join("")
  );
}

const signature: Theme = {
  defs: "",
  board: `<polygon points="${hexagon(HEX_ART_RADIUS)}" fill="#ffffff" stroke="#c4c4c4" stroke-width="0.012"/>`,
  base: (color, center, angle) => {
    const ink = SIGNATURE_INK[color];
    const R = HEX_BASE_RADIUS;
    // The square board's coloured frame and white panel, as rings; the four
    // nest badges sit on the coloured centre, with a small star between them.
    return (
      anchorCircle(`base-${color}`, center, R, `fill="${ink}"`) +
      around(
        center,
        angle,
        `<circle r="${n(R * 0.86)}" fill="#ffffff"/>` +
          `<circle r="${n(R * 0.76)}" fill="${ink}"/>` +
          star(5, R * 0.17, 0.42, `fill="#ffffff"`),
      )
    );
  },
  nest: (color, index, point) =>
    anchorCircle(`nest-${color}-${index}`, point, C * 0.6, `fill="#ffffff" stroke="${SIGNATURE_INK[color]}" stroke-width="0.012"`) +
    around(point, -Math.PI / 2, star(5, C * 0.46, 0.42, `fill="${SIGNATURE_INK[color]}"`)),
  hub: (color, arm) => {
    const [a, b] = hubTriangle(arm);
    const centroid: Vec2 = [(a[0] + b[0]) / 3, (a[1] + b[1]) / 3];
    return (
      `<polygon points="0,0 ${n(a[0])},${n(a[1])} ${n(b[0])},${n(b[1])}" fill="${SIGNATURE_INK[color]}" stroke="#ffffff" stroke-width="0.012"/>` +
      around(centroid, 0, signatureBadge(SIGNATURE_INK[color], C * 0.42))
    );
  },
  hubCenter: "",
  home: (color, index, point, arm) =>
    anchorCell(`home-${color}-${index}`, point, arm, `fill="${SIGNATURE_INK[color]}" stroke="#ffffff" stroke-width="0.01"`) +
    inCell(point, arm, signatureBadge(SIGNATURE_INK[color], C * 0.36)),
  track: (cell, point, arm, kind, owner) =>
    kind === "plain"
      ? anchorCell(`track-${cell}`, point, arm, `fill="#ffffff" stroke="#cfcfcf" stroke-width="0.01"`)
      : anchorCell(`track-${cell}`, point, arm, `fill="${SIGNATURE_INK[owner]}" stroke="#ffffff" stroke-width="0.01"`) +
        inCell(point, arm, signatureBadge(SIGNATURE_INK[owner], C * 0.36)),
  tip: (arm, color) => inCell(hexTipPoint(arm), arm, featheredArrow(SIGNATURE_INK[color])),
};

// ---------------------------------------------------------------------------
// Geometric: gradient inks, cream cells, gold-ringed 8-point medallions
// (board-geometric.svg)
// ---------------------------------------------------------------------------

const GEOMETRIC_RAMP: Record<PlayerColor, readonly string[]> = {
  red: ["rgb(230,57,70)", "rgb(200,29,37)", "rgb(122,10,16)"],
  green: ["rgb(46,204,113)", "rgb(0,135,81)", "rgb(0,77,46)"],
  yellow: ["rgb(255,224,102)", "rgb(244,196,48)", "rgb(184,134,11)"],
  blue: ["rgb(74,144,226)", "rgb(31,58,147)", "rgb(10,25,47)"],
  orange: ["rgb(255,170,90)", "rgb(236,120,20)", "rgb(140,62,0)"],
  black: ["rgb(120,122,138)", "rgb(59,60,72)", "rgb(18,19,26)"],
};
const GOLD = "rgb(212,175,55)";
const CREAM = "rgb(253,251,247)";
const geo = (color: PlayerColor) => `url(#geo-${color})`;

/** A cream disc with a gold ring holding an 8-point star — the geometric medallion. */
function geometricMedallion(fill: string, radius: number, disc = CREAM): string {
  return (
    `<circle r="${n(radius)}" fill="${disc}" stroke="${GOLD}" stroke-width="${n(radius * 0.12)}"/>` +
    star(8, radius * 0.78, 0.45, `fill="${fill}"`)
  );
}

const geometric: Theme = {
  defs:
    gradient("paper", ["rgb(253,251,247)", "rgb(250,244,232)", "rgb(240,232,213)"], true) +
    BOARD_6.colors.map((color) => gradient(`geo-${color}`, GEOMETRIC_RAMP[color])).join(""),
  board:
    `<polygon points="${hexagon(HEX_ART_RADIUS)}" fill="url(#paper)" stroke="${GOLD}" stroke-width="0.03"/>` +
    `<polygon points="${hexagon(HEX_ART_RADIUS - 0.06)}" fill="none" stroke="${GOLD}" stroke-width="0.008"/>`,
  base: (color, center, angle) => {
    const R = HEX_BASE_RADIUS;
    const ring = Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return around([Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9], 0, star(8, R * 0.05, 0.45, `fill="#ffffff"`));
    }).join("");
    return (
      anchorCircle(`base-${color}`, center, R, `fill="${geo(color)}" stroke="${GOLD}" stroke-width="0.014"`) +
      around(
        center,
        angle,
        ring +
          `<circle r="${n(R * 0.8)}" fill="url(#paper)" stroke="${GOLD}" stroke-width="0.008" stroke-dasharray="0.02 0.014"/>` +
          star(8, C * 0.3, 0.45, `fill="${GOLD}"`),
      )
    );
  },
  nest: (color, index, point) =>
    anchorCircle(`nest-${color}-${index}`, point, C * 0.6, `fill="${CREAM}" stroke="${GOLD}" stroke-width="0.012"`) +
    around(point, 0, star(8, C * 0.44, 0.45, `fill="${geo(color)}"`)),
  hub: (color, arm) => {
    const [a, b] = hubTriangle(arm);
    const centroid: Vec2 = [(a[0] + b[0]) / 3, (a[1] + b[1]) / 3];
    return (
      `<polygon points="0,0 ${n(a[0])},${n(a[1])} ${n(b[0])},${n(b[1])}" fill="${geo(color)}" stroke="${GOLD}" stroke-width="0.01"/>` +
      around(centroid, 0, star(8, C * 0.4, 0.45, `fill="#ffffff"`))
    );
  },
  hubCenter: around([0, 0], 0, geometricMedallion(GOLD, C * 0.5)),
  home: (color, index, point, arm) =>
    anchorCell(`home-${color}-${index}`, point, arm, `fill="${geo(color)}" stroke="${GOLD}" stroke-width="0.008"`),
  track: (cell, point, arm, kind, owner) =>
    kind === "entry"
      ? anchorCell(`track-${cell}`, point, arm, `fill="${geo(owner)}" stroke="${GOLD}" stroke-width="0.01"`) +
        inCell(point, arm, geometricMedallion("#ffffff", C * 0.36, geo(owner)))
      : anchorCell(`track-${cell}`, point, arm, `fill="${CREAM}" stroke="rgb(213,204,184)" stroke-width="0.008"`) +
        (kind === "star" ? inCell(point, arm, geometricMedallion(geo(owner), C * 0.38)) : ""),
  tip: (arm, color) => chevron(arm, GEOMETRIC_RAMP[color][1]),
};

// ---------------------------------------------------------------------------
// Aladdin: jewel-tone gradients on navy, gold rims, compass-rose safe squares
// (board-aladdin.svg)
// ---------------------------------------------------------------------------

const ALADDIN_RAMP: Record<PlayerColor, readonly string[]> = {
  red: ["rgb(176,42,42)", "rgb(125,26,26)", "rgb(63,11,11)"],
  green: ["rgb(31,122,66)", "rgb(20,81,43)", "rgb(8,42,20)"],
  yellow: ["rgb(212,164,28)", "rgb(154,116,16)", "rgb(74,52,6)"],
  blue: ["rgb(31,91,158)", "rgb(20,58,102)", "rgb(7,24,49)"],
  orange: ["rgb(214,112,30)", "rgb(150,72,14)", "rgb(72,32,4)"],
  black: ["rgb(104,116,138)", "rgb(62,72,92)", "rgb(26,32,44)"],
};
const GOLD_EDGE = "rgb(122,82,6)";
const jewel = (color: PlayerColor) => `url(#jewel-${color})`;

/** A navy disc with a gold rim and an eight-spoked compass rose. */
function compassRose(radius: number): string {
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const reach = i % 2 === 0 ? 0.82 : 0.55;
    return `<line x1="0" y1="0" x2="${n(Math.cos(a) * radius * reach)}" y2="${n(Math.sin(a) * radius * reach)}" stroke="url(#gold)" stroke-width="${n(radius * 0.09)}" stroke-linecap="round"/>`;
  }).join("");
  return (
    `<circle r="${n(radius)}" fill="url(#navy)" stroke="url(#gold)" stroke-width="${n(radius * 0.14)}"/>` +
    `<circle r="${n(radius * 0.62)}" fill="none" stroke="url(#gold)" stroke-width="${n(radius * 0.05)}"/>` +
    spokes +
    `<circle r="${n(radius * 0.14)}" fill="url(#gold)"/>`
  );
}

const aladdin: Theme = {
  defs:
    gradient("navy", ["rgb(18,39,90)", "rgb(10,24,54)", "rgb(3,8,26)"], true) +
    gradient("gold", ["rgb(251,234,160)", "rgb(233,194,92)", "rgb(212,160,23)", "rgb(169,118,12)", "rgb(240,192,64)"]) +
    gradient("lane", ["rgb(27,58,99)", "rgb(12,31,58)"]) +
    BOARD_6.colors.map((color) => gradient(`jewel-${color}`, ALADDIN_RAMP[color], true)).join(""),
  board:
    `<polygon points="${hexagon(HEX_ART_RADIUS)}" fill="url(#navy)" stroke="url(#gold)" stroke-width="0.05"/>` +
    `<polygon points="${hexagon(HEX_ART_RADIUS - 0.075)}" fill="none" stroke="${GOLD_EDGE}" stroke-width="0.01"/>`,
  base: (color, center, angle) => {
    const R = HEX_BASE_RADIUS;
    return (
      anchorCircle(`base-${color}`, center, R, `fill="${jewel(color)}" stroke="url(#gold)" stroke-width="0.02"`) +
      around(
        center,
        angle,
        `<circle r="${n(R * 0.9)}" fill="none" stroke="${GOLD_EDGE}" stroke-width="0.006"/>` +
          star(6, R * 0.86, 0.55, `fill="url(#gold)" stroke="${GOLD_EDGE}" stroke-width="0.006"`),
      )
    );
  },
  nest: (color, index, point) =>
    anchorCircle(`nest-${color}-${index}`, point, C * 0.6, `fill="url(#navy)" stroke="url(#gold)" stroke-width="0.014"`) +
    around(point, -Math.PI / 2, star(5, C * 0.3, 0.45, `fill="url(#gold)"`)),
  hub: (color, arm) => {
    const [a, b] = hubTriangle(arm);
    return `<polygon points="0,0 ${n(a[0])},${n(a[1])} ${n(b[0])},${n(b[1])}" fill="${jewel(color)}" stroke="url(#gold)" stroke-width="0.012"/>`;
  },
  // Kept inside the triangles' inner half: a finishing pawn touches down at
  // 0.55 of the hub apothem (hexGoalPoint), on its own colour.
  hubCenter: (() => {
    const r = HEX_HUB_APOTHEM * 0.42;
    const stars = Array.from({ length: 6 }, (_, i) => {
      const a = (i * Math.PI) / 3 + Math.PI / 6;
      return around([Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66], 0, star(5, r * 0.1, 0.45, `fill="url(#gold)"`, -Math.PI / 2));
    }).join("");
    return (
      `<circle r="${n(r)}" fill="url(#navy)" stroke="url(#gold)" stroke-width="0.018"/>` +
      `<circle r="${n(r * 0.84)}" fill="none" stroke="url(#gold)" stroke-width="0.005"/>` +
      `<circle r="${n(r * 0.42)}" fill="none" stroke="url(#gold)" stroke-width="0.005"/>` +
      stars +
      star(6, r * 0.3, 0.5, `fill="url(#gold)"`)
    );
  })(),
  home: (color, index, point, arm) =>
    anchorCell(`home-${color}-${index}`, point, arm, `fill="url(#lane)" stroke="${GOLD_EDGE}" stroke-width="0.008"`) +
    inCell(point, arm, star(5, C * 0.3, 0.45, `fill="url(#gold)"`)),
  track: (cell, point, arm, kind, owner) =>
    anchorCell(`track-${cell}`, point, arm, `fill="${jewel(kind === "entry" ? owner : BOARD_6.colors[arm])}" stroke="rgb(92,68,8)" stroke-width="0.008"`) +
    (kind === "plain" ? "" : inCell(point, arm, compassRose(C * 0.38))),
  tip: (arm) => chevron(arm, "rgb(233,194,92)"),
};

// ---------------------------------------------------------------------------
// Bazaar: jewel tones on espresso, brass trim, parchment home columns, brass
// trays and star medallions (board-bazaar.svg)
// ---------------------------------------------------------------------------

const BAZAAR_RAMP: Record<PlayerColor, readonly string[]> = {
  red: ["#D24A3E", "#651413"],
  green: ["#349A6B", "#103F2B"],
  yellow: ["#F0BC45", "#94600E"],
  blue: ["#4B78C4", "#16285A"],
  orange: ["#E0823A", "#7A3A0E"],
  black: ["#6A6272", "#24202A"],
};
// The jewel diamonds down each home column.
const BAZAAR_MOTIF: Record<PlayerColor, string> = {
  red: "#7A1A18",
  green: "#155238",
  yellow: "#A86B0F",
  blue: "#1E3570",
  orange: "#8A4210",
  black: "#3A3440",
};
const ESPRESSO = "#1E120B";
const BRASS_LINE = "#D9A845";
const PARCHMENT = "#F1E2C0";
const bazaarJewel = (color: PlayerColor) => `url(#bz-${color})`;

/** A brass disc on espresso: the board's medallion, holding `body`. */
function bazaarMedallion(radius: number, body: string): string {
  return (
    `<circle r="${n(radius)}" fill="url(#brass)"/>` +
    `<circle r="${n(radius * 0.83)}" fill="${ESPRESSO}"/>` +
    body
  );
}

const bazaar: Theme = {
  defs:
    gradient("brass", ["#F8E29A", "#D9A845", "#8A5E1C"]) +
    BOARD_6.colors.map((color) => gradient(`bz-${color}`, BAZAAR_RAMP[color], true)).join(""),
  board:
    `<polygon points="${hexagon(HEX_ART_RADIUS)}" fill="${ESPRESSO}" stroke="url(#brass)" stroke-width="0.05"/>` +
    `<polygon points="${hexagon(HEX_ART_RADIUS - 0.075)}" fill="none" stroke="${BRASS_LINE}" stroke-width="0.01"/>`,
  base: (color, center, angle) => {
    const R = HEX_BASE_RADIUS;
    return (
      anchorCircle(`base-${color}`, center, R, `fill="${bazaarJewel(color)}" stroke="url(#brass)" stroke-width="0.02"`) +
      around(
        center,
        angle,
        // A kilim border, then the yard's own eight-point star.
        `<circle r="${n(R * 0.9)}" fill="none" stroke="${PARCHMENT}" stroke-opacity="0.7" stroke-width="${n(R * 0.05)}" stroke-dasharray="${n(R * 0.06)} ${n(R * 0.06)}"/>` +
          `<circle r="${n(R * 0.83)}" fill="none" stroke="${BRASS_LINE}" stroke-width="0.006"/>` +
          star(8, R * 0.62, 0.7, `fill="${BAZAAR_RAMP[color][1]}"`),
      )
    );
  },
  nest: (color, index, point) =>
    anchorCircle(`nest-${color}-${index}`, point, C * 0.6, `fill="url(#brass)"`) +
    around(
      point,
      0,
      `<circle r="${n(C * 0.5)}" fill="${ESPRESSO}"/>` +
        `<circle r="${n(C * 0.42)}" fill="none" stroke="${BRASS_LINE}" stroke-width="0.006" stroke-dasharray="0.006 0.018"/>` +
        star(8, C * 0.17, 0.7, `fill="url(#brass)"`),
    ),
  hub: (color, arm) => {
    const [a, b] = hubTriangle(arm);
    return `<polygon points="0,0 ${n(a[0])},${n(a[1])} ${n(b[0])},${n(b[1])}" fill="${bazaarJewel(color)}" stroke="${BRASS_LINE}" stroke-width="0.012"/>`;
  },
  // Kept inside the triangles' inner half: a finishing pawn touches down at
  // 0.55 of the hub apothem (hexGoalPoint), on its own colour.
  hubCenter: (() => {
    const r = HEX_HUB_APOTHEM * 0.42;
    return (
      `<circle r="${n(r)}" fill="url(#brass)"/>` +
      `<circle r="${n(r * 0.9)}" fill="${ESPRESSO}"/>` +
      `<circle r="${n(r * 0.8)}" fill="none" stroke="${BRASS_LINE}" stroke-width="0.005" stroke-dasharray="0.008 0.018"/>` +
      star(8, r * 0.5, 0.7, `fill="url(#brass)"`) +
      `<circle r="${n(r * 0.12)}" fill="${ESPRESSO}"/>`
    );
  })(),
  home: (color, index, point, arm) =>
    anchorCell(`home-${color}-${index}`, point, arm, `fill="${PARCHMENT}" stroke="${BRASS_LINE}" stroke-width="0.01"`) +
    inCell(
      point,
      arm,
      `<polygon points="${n(-C * 0.3)},0 0,${n(-C * 0.22)} ${n(C * 0.3)},0 0,${n(C * 0.22)}" fill="${BAZAAR_MOTIF[color]}" stroke="${BRASS_LINE}" stroke-width="0.008"/>`,
    ),
  track: (cell, point, arm, kind, owner) =>
    anchorCell(`track-${cell}`, point, arm, `fill="${bazaarJewel(kind === "entry" ? owner : BOARD_6.colors[arm])}" stroke="${BRASS_LINE}" stroke-width="0.01"`) +
    (kind === "star"
      ? inCell(point, arm, bazaarMedallion(C * 0.36, star(8, C * 0.17, 0.7, `fill="url(#brass)"`)))
      : kind === "entry"
        ? inCell(
            point,
            arm,
            bazaarMedallion(
              C * 0.36,
              `<polygon points="${n(-C * 0.14)},0 0,${n(-C * 0.14)} ${n(C * 0.14)},0 0,${n(C * 0.14)}" fill="${PARCHMENT}"/>`,
            ),
          )
        : ""),
  tip: (arm) => chevron(arm, "#F3D07A"),
};

// ---------------------------------------------------------------------------
// Rug: natural dyes on a dark ground, a madder border, camel-wool track, and
// the stepped diamonds of a Balochi rug (board-rug.svg)
// ---------------------------------------------------------------------------

const RUG_DYE: Record<PlayerColor, string> = {
  red: "#9B2D24",
  green: "#3D6B55",
  yellow: "#C68B2C",
  blue: "#24395F",
  orange: "#B35A1F",
  black: "#3A302C",
};
const RUG_GROUND = "#2B1B15";
const RUG_IVORY = "#EDE0C4";
const RUG_CAMEL = "#C9AE80";
// The border's madder, and the safe stars' (a step off the red seat's, so
// colour-blind mode leaves them be, as on the square board).
const RUG_BORDER = "#5E1612";
const RUG_STAR = "#9B2D25";

/** The rug's stepped diamond (#rg-step in board-rug.svg), `radius` from tip to tip's centre. */
function steppedDiamond(radius: number, attrs: string): string {
  const unit = radius / 100;
  const quarter = [
    [-10, -100], [10, -100], [10, -80], [30, -80], [30, -60], [50, -60], [50, -40], [70, -40],
    [70, -20], [90, -20], [90, -10], [100, -10],
  ];
  // One quarter, then the same turned three times about the centre.
  const points = [0, 1, 2, 3].flatMap((turn) =>
    quarter.map(([x, y]) => {
      const [a, b] = [[x, y], [-y, x], [-x, -y], [y, -x]][turn];
      return `${n(a * unit)},${n(b * unit)}`;
    }),
  );
  return `<polygon points="${points.join(" ")}" ${attrs}/>`;
}

const rug: Theme = {
  defs: "",
  board:
    `<polygon points="${hexagon(HEX_ART_RADIUS)}" fill="${RUG_BORDER}" stroke="${RUG_IVORY}" stroke-width="0.02"/>` +
    `<polygon points="${hexagon(HEX_ART_RADIUS - 0.07)}" fill="${RUG_GROUND}" stroke="${RUG_IVORY}" stroke-width="0.012"/>`,
  base: (color, center, angle) => {
    const R = HEX_BASE_RADIUS;
    return (
      anchorCircle(`base-${color}`, center, R, `fill="${RUG_DYE[color]}" stroke="${RUG_IVORY}" stroke-width="0.016"`) +
      around(
        center,
        angle,
        // A guard border of small ivory diamonds round the yard's edge.
        `<circle r="${n(R * 0.88)}" fill="none" stroke="${RUG_GROUND}" stroke-width="${n(R * 0.13)}"/>` +
          Array.from({ length: 16 }, (_, i) =>
            around(hexPolar((i * Math.PI) / 8, R * 0.88), 0, steppedDiamond(R * 0.05, `fill="${RUG_IVORY}"`)),
          ).join(""),
      )
    );
  },
  nest: (color, index, point) =>
    anchorCircle(`nest-${color}-${index}`, point, C * 0.6, `fill="${RUG_IVORY}"`) +
    around(
      point,
      0,
      `<circle r="${n(C * 0.5)}" fill="${RUG_GROUND}"/>` + steppedDiamond(C * 0.3, `fill="${RUG_CAMEL}"`),
    ),
  hub: (color, arm) => {
    const [a, b] = hubTriangle(arm);
    return `<polygon points="0,0 ${n(a[0])},${n(a[1])} ${n(b[0])},${n(b[1])}" fill="${RUG_DYE[color]}" stroke="${RUG_IVORY}" stroke-width="0.012"/>`;
  },
  // Kept inside the triangles' inner half: a finishing pawn touches down at
  // 0.55 of the hub apothem (hexGoalPoint), on its own colour.
  hubCenter: (() => {
    const r = HEX_HUB_APOTHEM * 0.42;
    return (
      `<circle r="${n(r)}" fill="${RUG_IVORY}"/>` +
      `<circle r="${n(r * 0.88)}" fill="${RUG_GROUND}"/>` +
      steppedDiamond(r * 0.7, `fill="${RUG_IVORY}"`) +
      steppedDiamond(r * 0.5, `fill="${RUG_GROUND}"`) +
      star(8, r * 0.34, 0.75, `fill="${RUG_IVORY}"`)
    );
  })(),
  home: (color, index, point, arm) =>
    anchorCell(`home-${color}-${index}`, point, arm, `fill="${RUG_DYE[color]}" stroke="${RUG_GROUND}" stroke-width="0.012"`) +
    inCell(point, arm, steppedDiamond(C * 0.32, `fill="${RUG_IVORY}"`) + steppedDiamond(C * 0.18, `fill="${RUG_GROUND}"`)),
  track: (cell, point, arm, kind, owner) =>
    anchorCell(
      `track-${cell}`,
      point,
      arm,
      `fill="${kind === "entry" ? RUG_DYE[owner] : kind === "star" ? RUG_GROUND : RUG_CAMEL}" stroke="${RUG_GROUND}" stroke-width="0.012"`,
    ) +
    (kind === "star"
      ? around(point, 0, star(8, C * 0.36, 0.72, `fill="${RUG_IVORY}"`) + star(8, C * 0.25, 0.72, `fill="${RUG_STAR}"`))
      : ""),
  tip: (arm) => chevron(arm, RUG_IVORY),
};

// ---------------------------------------------------------------------------
// Mosaic: glazed tiles on navy, gold lines, eight-point stars and rosettes
// (board-mosaic.svg)
// ---------------------------------------------------------------------------

const MOSAIC_GLAZE: Record<PlayerColor, readonly string[]> = {
  red: ["#C2533A", "#6E2414"],
  green: ["#1A978D", "#0A4F4A"],
  yellow: ["#E0A637", "#8E5D10"],
  blue: ["#2F5BBE", "#142A63"],
  orange: ["#D8691C", "#7A3508"],
  black: ["#4A5266", "#1E2330"],
};
const MOSAIC_NAVY = "#0F1C3A";
const MOSAIC_GOLD = "#C9A04A";
const MOSAIC_CREAM = "#F3EBDA";
const MOSAIC_LINE = "#B9C7DD";
const MOSAIC_TEAL = "#1E8C93";
const mosaicGlaze = (color: PlayerColor) => `url(#mo-${color})`;

/** Two eight-point stars, one turned a sixteenth: the board's rosette. */
function rosette(radius: number, attrs: string): string {
  return star(8, radius, 0.765, attrs) + star(8, radius, 0.765, attrs, Math.PI / 8);
}

const mosaic: Theme = {
  defs: BOARD_6.colors.map((color) => gradient(`mo-${color}`, MOSAIC_GLAZE[color], true)).join(""),
  board:
    `<polygon points="${hexagon(HEX_ART_RADIUS)}" fill="${MOSAIC_NAVY}" stroke="${MOSAIC_GOLD}" stroke-width="0.04"/>` +
    `<polygon points="${hexagon(HEX_ART_RADIUS - 0.07)}" fill="none" stroke="${MOSAIC_GOLD}" stroke-width="0.01"/>`,
  base: (color, center, angle) => {
    const R = HEX_BASE_RADIUS;
    return (
      anchorCircle(`base-${color}`, center, R, `fill="${mosaicGlaze(color)}" stroke="${MOSAIC_GOLD}" stroke-width="0.018"`) +
      around(
        center,
        angle,
        // A navy band of small cream stars round the yard's edge.
        `<circle r="${n(R * 0.88)}" fill="none" stroke="${MOSAIC_NAVY}" stroke-width="${n(R * 0.13)}"/>` +
          Array.from({ length: 12 }, (_, i) =>
            around(hexPolar((i * Math.PI) / 6, R * 0.88), 0, star(8, R * 0.05, 0.6, `fill="${MOSAIC_CREAM}"`)),
          ).join(""),
      )
    );
  },
  nest: (color, index, point) =>
    anchorCircle(`nest-${color}-${index}`, point, C * 0.6, `fill="${MOSAIC_GOLD}"`) +
    around(point, 0, `<circle r="${n(C * 0.52)}" fill="${MOSAIC_NAVY}"/>` + star(8, C * 0.38, 0.765, `fill="${MOSAIC_CREAM}"`)),
  hub: (color, arm) => {
    const [a, b] = hubTriangle(arm);
    return `<polygon points="0,0 ${n(a[0])},${n(a[1])} ${n(b[0])},${n(b[1])}" fill="${mosaicGlaze(color)}" stroke="${MOSAIC_CREAM}" stroke-width="0.012"/>`;
  },
  // Kept inside the triangles' inner half: a finishing pawn touches down at
  // 0.55 of the hub apothem (hexGoalPoint), on its own colour.
  hubCenter: (() => {
    const r = HEX_HUB_APOTHEM * 0.42;
    return (
      `<circle r="${n(r)}" fill="${MOSAIC_GOLD}"/>` +
      `<circle r="${n(r * 0.9)}" fill="${MOSAIC_NAVY}"/>` +
      rosette(r * 0.78, `fill="${MOSAIC_GOLD}"`) +
      star(8, r * 0.52, 0.765, `fill="${MOSAIC_CREAM}"`) +
      star(8, r * 0.32, 0.765, `fill="${MOSAIC_TEAL}"`, Math.PI / 8) +
      `<circle r="${n(r * 0.1)}" fill="${MOSAIC_GOLD}"/>`
    );
  })(),
  home: (color, index, point, arm) =>
    anchorCell(`home-${color}-${index}`, point, arm, `fill="${MOSAIC_GLAZE[color][0]}" stroke="${MOSAIC_NAVY}" stroke-width="0.012"`) +
    around(point, 0, star(8, C * 0.3, 0.765, `fill="${MOSAIC_CREAM}"`) + `<circle r="${n(C * 0.09)}" fill="${MOSAIC_GOLD}"/>`),
  track: (cell, point, arm, kind, owner) =>
    anchorCell(
      `track-${cell}`,
      point,
      arm,
      `fill="${kind === "entry" ? MOSAIC_GLAZE[owner][0] : kind === "star" ? MOSAIC_NAVY : MOSAIC_CREAM}" stroke="${MOSAIC_NAVY}" stroke-width="0.012"`,
    ) +
    (kind === "star"
      ? around(point, 0, rosette(C * 0.36, `fill="${MOSAIC_GOLD}"`) + star(8, C * 0.2, 0.765, `fill="${MOSAIC_TEAL}"`))
      : kind === "plain"
        ? around(point, 0, star(8, C * 0.3, 0.765, `fill="none" stroke="${MOSAIC_LINE}" stroke-width="0.008"`))
        : ""),
  tip: (arm) => chevron(arm, MOSAIC_CREAM),
};

const THEMES: Record<HexBoardStyle, Theme> = { classic, signature, geometric, aladdin, bazaar, rug, mosaic };

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/**
 * The hex board in `style` as an SVG document — the starting point for its
 * file in designs/ (`npm run board:hex`), which may then be restyled by hand.
 */
export function hexBoardSvg(style: HexBoardStyle = "classic"): string {
  const theme = THEMES[style];
  const r = HEX_ART_RADIUS;
  const parts: string[] = [];
  if (theme.defs) parts.push(`<defs>${theme.defs}</defs>`);
  parts.push(theme.board);
  BOARD_6.colors.forEach((color, arm) => {
    const angle = hexBaseAngle(color);
    parts.push(theme.base(color, hexBaseCenter(color), angle));
    for (let index = 0; index < 4; index++) parts.push(theme.nest(color, index, hexNestPoint(color, index), angle));
    parts.push(theme.hub(color, arm));
  });
  if (theme.hubCenter) parts.push(theme.hubCenter);
  BOARD_6.colors.forEach((color, arm) => {
    for (let index = 0; index < BOARD_6.homeLaneLength; index++)
      parts.push(theme.home(color, index, hexHomeLanePoint(color, index), arm));
  });
  // Each colour's entry, and a star 8 steps on: the two safe cells per arm.
  for (let cell = 0; cell < BOARD_6.trackLength; cell++) {
    const { arm, step } = hexTrackSegment(cell);
    const entryOf = BOARD_6.colors.find((color) => BOARD_6.entryOffset[color] === cell);
    const kind: CellKind = entryOf ? "entry" : BOARD_6.safeCells.has(cell) ? "star" : "plain";
    parts.push(theme.track(cell, hexTrackPoint(cell), arm, kind, entryOf ?? BOARD_6.colors[arm]));
    if (step === 6) parts.push(theme.tip(arm, BOARD_6.colors[arm]));
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(-r)} ${n(-r)} ${n(2 * r)} ${n(2 * r)}">`,
    `  <!-- The 5-6 player hexagonal board, ${style} style (F5.2). First generated by`,
    "       `npm run board:hex` from lib/presentation/hexArtwork.ts; restyle it freely",
    "       (colours, strokes, decoration, extra artwork). Pawns are placed from",
    "       lib/presentation/hexBoard.ts, so keep the viewBox, and keep every element",
    "       with an id (track-*, home-*, base-*, nest-*) where it is: the tests check",
    "       them. Keep those elements outside any transformed group. -->",
    ...parts.map((part) => `  ${part}`),
    "</svg>",
    "",
  ].join("\n");
}
