/**
 * Colour-blind support for the table (docs/COMPETITIVE_ROADMAP.md F5.5):
 * the alternative seat palette, the per-seat symbols that make identity
 * independent of colour, and the recolouring of the printed board artwork so
 * pawns and their bases keep matching under the new palette.
 *
 * Pure (no DOM, no three), so tests/presentation/accessibility.test.ts can
 * check the palette with a colour-vision simulation and the recolouring on
 * plain strings and pixel arrays.
 */
import type { PlayerColor } from "../board/types";
import { COLORS } from "./board";

/**
 * Seat colours for "Colour-blind mode". Picked by searching each seat's hue
 * family for the set whose closest pair stays furthest apart (CIEDE2000)
 * under simulated protanopia, deuteranopia and tritanopia (Machado 2009,
 * full severity), with the board's cream background counted as a seventh
 * colour so no seat washes into it. The worst pair is still ΔE ≥ 20; the
 * default palette's worst is ~6 (green/blue under tritanopia).
 */
export const COLOR_BLIND_COLORS: Record<PlayerColor, string> = {
  red: "#8b1312",
  green: "#14ab97",
  yellow: "#f4cf34",
  blue: "#135dc7",
  orange: "#cf620e",
  black: "#1d1d22",
};

/** The colours seats are drawn in, for whichever palette is on. */
export function seatColors(colorBlind: boolean): Record<PlayerColor, string> {
  return colorBlind ? COLOR_BLIND_COLORS : COLORS;
}

// --- Symbols ----------------------------------------------------------------

export type SeatSymbol = "circle" | "triangle" | "square" | "diamond" | "star" | "cross";

/** Each seat's symbol, so who's who never rests on colour alone. */
export const SEAT_SYMBOLS: Record<PlayerColor, SeatSymbol> = {
  red: "circle",
  green: "triangle",
  yellow: "square",
  blue: "diamond",
  orange: "star",
  black: "cross",
};

/** The symbol's spoken name, for labels that also show the shape. */
export const SEAT_SYMBOL_NAMES: Record<SeatSymbol, string> = {
  circle: "circle",
  triangle: "triangle",
  square: "square",
  diamond: "diamond",
  star: "star",
  cross: "cross",
};

function regular(sides: number, radius: number, start: number, dy = 0): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = start + (i * 2 * Math.PI) / sides;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius + dy];
  });
}

/**
 * A symbol's outline as a closed polygon, counter-clockwise, y up, inside the
 * unit circle and sized so the six read as about the same weight.
 */
export function symbolOutline(symbol: SeatSymbol): [number, number][] {
  switch (symbol) {
    case "circle":
      return regular(32, 0.8, 0);
    case "triangle":
      // Pointing up, nudged down so it sits optically centred.
      return regular(3, 0.9, Math.PI / 2, -0.1);
    case "square":
      return regular(4, 0.98, Math.PI / 4);
    case "diamond":
      return regular(4, 1, Math.PI / 2);
    case "star":
      return Array.from({ length: 10 }, (_, i): [number, number] => {
        const angle = Math.PI / 2 + (i * Math.PI) / 5;
        const radius = i % 2 ? 0.44 : 1;
        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
      });
    case "cross": {
      const a = 0.3;
      const b = 0.92;
      return [
        [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b],
        [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a], [-a, -b],
      ];
    }
  }
}

/** The outline as an SVG `points` list for a `viewBox="-1 -1 2 2"` (y down). */
export function symbolSvgPoints(symbol: SeatSymbol): string {
  return symbolOutline(symbol)
    .map(([x, y]) => `${+x.toFixed(3)},${+(-y).toFixed(3)}`)
    .join(" ");
}

// --- Recolouring the printed boards ----------------------------------------

type Rgb = [number, number, number];

function parseColor(value: string): Rgb {
  const rgb = value.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  throw new Error(`Not a colour: ${value}`);
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function toHsl([r, g, b]: Rgb): Rgb {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h =
    max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function fromHsl([h, s, l]: Rgb): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Carries one shade of a seat's artwork over to the new palette. `primary` is
 * the seat's main ink and lands exactly on `target`; lighter and darker
 * shades (gradient stops, outlines) keep where they sat between the main ink
 * and white or black, so a jewel's highlight and shadow survive the change.
 */
export function shiftSeatShade(shade: string, primary: string, target: string): string {
  const [, ss, sl] = toHsl(parseColor(shade));
  const [, ps, pl] = toHsl(parseColor(primary));
  const [th, ts, tl] = toHsl(parseColor(target));
  const l =
    sl >= pl
      ? tl + (1 - tl) * (pl >= 1 ? 0 : (sl - pl) / (1 - pl))
      : tl * (pl <= 0 ? 1 : sl / pl);
  const s = ps > 0 ? Math.min(1, (ts * ss) / ps) : ts;
  return toHex(fromHsl([th, s, l]));
}

/** Seat shades in one board's artwork: the main ink first, then its other shades. */
export type SeatShades = Partial<Record<PlayerColor, string[]>>;

const rgb = (r: number, g: number, b: number) => `rgb(${r},${g},${b})`;

/**
 * Every seat-coloured shade in each vector board, by artwork. Listed by hand
 * rather than found by hue because the Aladdin and Geometric boards are built
 * from golds that sit right beside the yellow seat; only these exact values
 * belong to a seat.
 */
export const BOARD_SEAT_SHADES: Record<string, SeatShades> = {
  classic: {
    red: ["#e2262e"],
    green: ["#31a65b"],
    yellow: ["#f2c400"],
    blue: ["#224c9e"],
  },
  geometric: {
    red: [rgb(200, 29, 37), rgb(230, 57, 70), rgb(122, 10, 16), rgb(139, 0, 0)],
    green: [rgb(0, 135, 81), rgb(46, 204, 113), rgb(0, 77, 46), rgb(0, 92, 55)],
    yellow: [rgb(244, 196, 48), rgb(255, 224, 102), rgb(184, 134, 11)],
    blue: [rgb(31, 58, 147), rgb(74, 144, 226), rgb(18, 38, 102)],
  },
  aladdin: {
    red: [rgb(176, 42, 42), rgb(125, 26, 26), rgb(63, 11, 11)],
    green: [rgb(31, 122, 66), rgb(20, 81, 43), rgb(8, 42, 20)],
    yellow: [rgb(212, 164, 28), rgb(154, 116, 16), rgb(74, 52, 6)],
    blue: [rgb(31, 91, 158), rgb(20, 58, 102), rgb(7, 24, 49)],
  },
  // The Bazaar's jewel gradients, then its home-column diamonds (and the
  // saffron diamonds' darker outline). Its brass is not a seat colour.
  bazaar: {
    red: ["#D24A3E", "#651413", "#7A1A18"],
    green: ["#349A6B", "#103F2B", "#155238"],
    yellow: ["#F0BC45", "#94600E", "#A86B0F", "#7A4E0E"],
    blue: ["#4B78C4", "#16285A", "#1E3570"],
  },
  // The Rug's dyes. Its borders and stars use twins one step off these, so
  // only the seat areas move.
  rug: {
    red: ["#9B2D24"],
    green: ["#3D6B55"],
    yellow: ["#C68B2C"],
    blue: ["#24395F"],
  },
  // The Mosaic's seat glazes and their tile patterns' deep grounds.
  mosaic: {
    red: ["#C2533A", "#6E2414"],
    green: ["#1A978D", "#0A4F4A"],
    yellow: ["#E0A637", "#8E5D10"],
    blue: ["#2F5BBE", "#142A63"],
  },
  // The Sindbad's harbour colours (its yards, sails, lanes and triangles).
  sindbad: {
    red: ["#C9473A"],
    green: ["#2E8B6E"],
    yellow: ["#E0A03A"],
    blue: ["#2C5D9E"],
  },
  // The Pink Glam's yard, lane and triangle colours (hot pink, aqua,
  // sunshine, lavender), which its sparkles and heart gem share.
  glam: {
    red: ["#E6268C"],
    green: ["#23B5C9"],
    yellow: ["#F7B928"],
    blue: ["#9A62D3"],
  },
  // The Cinderella's yards, lanes, starts and triangles (rose, mint, pumpkin,
  // crystal blue), which also tint its emblems and pearls.
  cinderella: {
    red: ["#D45A88"],
    green: ["#3FA78A"],
    yellow: ["#E07B26"],
    blue: ["#4F8FD9"],
  },
  // The Pink Bows' yards, lanes, starts and triangles (bubblegum, mint, peach,
  // lilac). Its darker bows and ribbon are not seat colours.
  bows: {
    red: ["#EC5F9E"],
    green: ["#4DBF9F"],
    yellow: ["#F6A04D"],
    blue: ["#A07BD8"],
  },
  // The Boba's flavours (strawberry, matcha, mango, taro): each cup, disc, lane,
  // start and triangle, then the pastel its yard is tinted with.
  boba: {
    red: ["#EE7799", "#FCDDE6"],
    green: ["#78B062", "#DDEFD3"],
    yellow: ["#F2A33A", "#FDE8C8"],
    blue: ["#9B7BC8", "#E4D8F3"],
  },
  "hex-classic": {
    red: ["#e2262e"],
    green: ["#31a65b"],
    yellow: ["#f2c400"],
    blue: ["#224c9e"],
    orange: ["#ef7d1a"],
    black: ["#3b3b46"],
  },
  "hex-signature": {
    red: ["#d0232b"],
    green: ["#72b865"],
    yellow: ["#f1df24"],
    blue: ["#2e3192"],
    orange: ["#f2891f"],
    black: ["#34343f"],
  },
  "hex-geometric": {
    red: [rgb(200, 29, 37), rgb(230, 57, 70), rgb(122, 10, 16)],
    green: [rgb(0, 135, 81), rgb(46, 204, 113), rgb(0, 77, 46)],
    yellow: [rgb(244, 196, 48), rgb(255, 224, 102), rgb(184, 134, 11)],
    blue: [rgb(31, 58, 147), rgb(74, 144, 226)],
    orange: [rgb(236, 120, 20), rgb(255, 170, 90), rgb(140, 62, 0)],
    black: [rgb(59, 60, 72)],
  },
  "hex-aladdin": {
    red: [rgb(176, 42, 42), rgb(125, 26, 26), rgb(63, 11, 11)],
    green: [rgb(31, 122, 66), rgb(20, 81, 43), rgb(8, 42, 20)],
    yellow: [rgb(212, 164, 28), rgb(154, 116, 16), rgb(74, 52, 6)],
    blue: [rgb(31, 91, 158), rgb(20, 58, 102), rgb(7, 24, 49)],
    orange: [rgb(214, 112, 30), rgb(150, 72, 14), rgb(72, 32, 4)],
    black: [rgb(104, 116, 138), rgb(62, 72, 92), rgb(26, 32, 44)],
  },
  "hex-bazaar": {
    red: ["#D24A3E", "#651413", "#7A1A18"],
    green: ["#349A6B", "#103F2B", "#155238"],
    yellow: ["#F0BC45", "#94600E", "#A86B0F"],
    blue: ["#4B78C4", "#16285A", "#1E3570"],
    orange: ["#E0823A", "#7A3A0E", "#8A4210"],
    black: ["#6A6272", "#24202A", "#3A3440"],
  },
  "hex-rug": {
    red: ["#9B2D24"],
    green: ["#3D6B55"],
    yellow: ["#C68B2C"],
    blue: ["#24395F"],
    orange: ["#B35A1F"],
    black: ["#3A302C"],
  },
  "hex-mosaic": {
    red: ["#C2533A", "#6E2414"],
    green: ["#1A978D", "#0A4F4A"],
    yellow: ["#E0A637", "#8E5D10"],
    blue: ["#2F5BBE", "#142A63"],
    orange: ["#D8691C", "#7A3508"],
    black: ["#4A5266", "#1E2330"],
  },
  "hex-sindbad": {
    red: ["#C9473A"],
    green: ["#2E8B6E"],
    yellow: ["#E0A03A"],
    blue: ["#2C5D9E"],
    orange: ["#D2691E"],
    black: ["#3A4250"],
  },
  "hex-glam": {
    red: ["#E6268C"],
    green: ["#23B5C9"],
    yellow: ["#F7B928"],
    blue: ["#9A62D3"],
    orange: ["#FF7A45"],
    black: ["#4A2E4F"],
  },
  "hex-cinderella": {
    red: ["#D45A88"],
    green: ["#3FA78A"],
    yellow: ["#E8B442"],
    blue: ["#4F8FD9"],
    orange: ["#E07B26"],
    black: ["#4A4466"],
  },
  "hex-bows": {
    red: ["#EC5F9E"],
    green: ["#4DBF9F"],
    yellow: ["#F2C94C"],
    blue: ["#A07BD8"],
    orange: ["#F6A04D"],
    black: ["#5B4B63"],
  },
  "hex-boba": {
    red: ["#EE7799"],
    green: ["#78B062"],
    yellow: ["#F4B942"],
    blue: ["#9B7BC8"],
    orange: ["#DD6A2C"],
    black: ["#5A3A28"],
  },
};

/**
 * Rewrites a vector board's seat colours in the SVG source, before it is
 * rasterized. Matches both `rgb(r,g,b)` and `#rrggbb` spellings.
 */
export function recolorBoardSvg(
  svg: string,
  shades: SeatShades,
  targets: Record<PlayerColor, string> = COLOR_BLIND_COLORS,
): string {
  const replacements = new Map<string, string>();
  for (const [color, list] of Object.entries(shades) as [PlayerColor, string[]][]) {
    for (const shade of list) {
      replacements.set(
        parseColor(shade).join(","),
        shiftSeatShade(shade, list[0], targets[color]),
      );
    }
  }
  return svg.replace(
    /rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|#[0-9a-f]{6}\b/gi,
    (match) => replacements.get(parseColor(match).join(",")) ?? match,
  );
}

/** The four inks gradeLudoInks pulls the raster (signature) board onto. */
export const LUDO_INKS: Record<"red" | "green" | "blue" | "yellow", Rgb> = {
  red: [226, 38, 46],
  green: [49, 166, 91],
  blue: [34, 76, 158],
  yellow: [242, 196, 0],
};

/** Which of the four inks a board pixel belongs to, if any (gradeLudoInks' own test). */
export function classifyLudoInk(r: number, g: number, b: number): keyof typeof LUDO_INKS | null {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  if (Math.max(rn, gn, bn) - Math.min(rn, gn, bn) < 0.22) return null;
  if (rn > 0.68 && gn > 0.58 && bn < 0.48) return "yellow";
  if (rn > gn * 1.45 && rn > bn * 1.35) return "red";
  if (gn > rn * 1.16 && gn > bn * 1.12) return "green";
  if (bn > rn * 1.3 && bn > gn * 1.18) return "blue";
  return null;
}

/**
 * Moves the raster board's seat inks onto the colour-blind palette, in place.
 * A pixel is read as a blend of its ink and whatever lies under it (paper,
 * shading); shifting it by that share of (target − ink) keeps the blend, so
 * anti-aliased edges and printed texture carry over.
 */
export function recolorLudoInkPixels(
  data: Uint8ClampedArray,
  targets: Record<PlayerColor, string> = COLOR_BLIND_COLORS,
) {
  const shifts = Object.fromEntries(
    (Object.keys(LUDO_INKS) as (keyof typeof LUDO_INKS)[]).map((ink) => {
      const source = LUDO_INKS[ink];
      const target = parseColor(targets[ink]);
      const spread = Math.max(...source) - Math.min(...source);
      return [ink, { delta: target.map((v, i) => v - source[i]) as Rgb, spread }];
    }),
  ) as Record<keyof typeof LUDO_INKS, { delta: Rgb; spread: number }>;
  for (let i = 0; i < data.length; i += 4) {
    const ink = classifyLudoInk(data[i], data[i + 1], data[i + 2]);
    if (!ink) continue;
    const { delta, spread } = shifts[ink];
    const share = Math.min(
      1,
      (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])) /
        spread,
    );
    data[i] += delta[0] * share;
    data[i + 1] += delta[1] * share;
    data[i + 2] += delta[2] * share;
  }
}
