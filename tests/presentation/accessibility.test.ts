import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlayerColor } from "../../lib/board/types";
import { COLORS } from "../../lib/presentation/board";
import {
  BOARD_SEAT_SHADES,
  COLOR_BLIND_COLORS,
  LUDO_INKS,
  SEAT_SYMBOLS,
  classifyLudoInk,
  recolorBoardSvg,
  recolorLudoInkPixels,
  shiftSeatShade,
  symbolOutline,
  symbolSvgPoints,
} from "../../lib/presentation/accessibility";

// --- A colour-vision simulator: Machado, Oliveira & Fernandes (2009), full
// severity, applied in linear sRGB; distances are CIEDE2000.
const CVD = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
  typical: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
} as const;
type Vision = keyof typeof CVD;

function lab(hex: string, vision: Vision): [number, number, number] {
  const linear = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = CVD[vision].map((row) =>
    Math.min(1, Math.max(0, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])),
  );
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE2000([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + G);
  const ap2 = a2 * (1 + G);
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const hue = (b: number, a: number) => ((Math.atan2(b, a) / rad) + 360) % 360;
  const h1 = hue(b1, ap1);
  const h2 = hue(b2, ap2);
  let dh = 0;
  if (Cp1 * Cp2) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);
  const Lbar = (L1 + L2) / 2;
  const Cpbar = (Cp1 + Cp2) / 2;
  let hbar = h1 + h2;
  if (Cp1 * Cp2) hbar = Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2;
  hbar %= 360;
  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * rad) +
    0.24 * Math.cos(2 * hbar * rad) +
    0.32 * Math.cos((3 * hbar + 6) * rad) -
    0.2 * Math.cos((4 * hbar - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cpbar ** 7 / (Cpbar ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cpbar;
  const SH = 1 + 0.015 * Cpbar * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt(
    (dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH),
  );
}

/** The closest pair of colours, as seen with each kind of colour vision. */
function closestPair(palette: Record<string, string>) {
  const names = Object.keys(palette);
  let worst = { distance: Infinity, pair: "", vision: "" };
  for (const vision of Object.keys(CVD) as Vision[])
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const distance = deltaE2000(lab(palette[names[i]], vision), lab(palette[names[j]], vision));
        if (distance < worst.distance)
          worst = { distance, pair: `${names[i]}/${names[j]}`, vision };
      }
  return worst;
}

const BOARD_PAPER = "#fdfbf7";
const SEATS: PlayerColor[] = ["red", "green", "yellow", "blue", "orange", "black"];

describe("colour-blind palette", () => {
  it("keeps every seat, and the board paper, apart under each colour-vision deficiency", () => {
    const worst = closestPair({ ...COLOR_BLIND_COLORS, paper: BOARD_PAPER });
    expect(worst.distance, `${worst.pair} under ${worst.vision}`).toBeGreaterThanOrEqual(20);
  });

  it("is a real improvement on the default palette", () => {
    expect(closestPair(COLORS).distance).toBeLessThan(10);
  });
});

describe("seat symbols", () => {
  it("gives every seat its own symbol", () => {
    expect(new Set(SEATS.map((color) => SEAT_SYMBOLS[color])).size).toBe(SEATS.length);
  });

  it("draws closed, counter-clockwise outlines inside the unit circle", () => {
    for (const color of SEATS) {
      const outline = symbolOutline(SEAT_SYMBOLS[color]);
      expect(outline.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of outline) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1.0001);
      // Shoelace: positive area means counter-clockwise (y up).
      const area = outline.reduce((sum, [x1, y1], i) => {
        const [x2, y2] = outline[(i + 1) % outline.length];
        return sum + x1 * y2 - x2 * y1;
      }, 0);
      expect(area).toBeGreaterThan(0);
    }
  });

  it("flips y for SVG", () => {
    // The triangle points up on screen, so its apex has the smallest SVG y.
    const ys = symbolSvgPoints("triangle")
      .split(" ")
      .map((point) => Number(point.split(",")[1]));
    expect(ys[0]).toBe(Math.min(...ys));
  });
});

describe("board recolouring", () => {
  it("lands a seat's main ink exactly on its new colour", () => {
    expect(shiftSeatShade("#e2262e", "#e2262e", COLOR_BLIND_COLORS.red)).toBe(COLOR_BLIND_COLORS.red);
  });

  it("keeps lighter and darker shades lighter and darker", () => {
    const light = shiftSeatShade("rgb(230,57,70)", "rgb(200,29,37)", COLOR_BLIND_COLORS.red);
    const dark = shiftSeatShade("rgb(122,10,16)", "rgb(200,29,37)", COLOR_BLIND_COLORS.red);
    const lightness = (hex: string) => lab(hex, "typical")[0];
    expect(lightness(light)).toBeGreaterThan(lightness(COLOR_BLIND_COLORS.red));
    expect(lightness(dark)).toBeLessThan(lightness(COLOR_BLIND_COLORS.red));
  });

  it("rewrites both spellings and leaves other colours alone", () => {
    const svg =
      '<rect fill="#E2262E"/><stop style="stop-color:rgb(176, 42, 42)"/><rect fill="rgb(212,175,55)"/>';
    const out = recolorBoardSvg(svg, {
      red: ["#e2262e", "rgb(176,42,42)"],
    });
    expect(out).toContain(`fill="${COLOR_BLIND_COLORS.red}"`);
    expect(out).not.toContain("176, 42, 42");
    // The geometric board's gold is not a seat colour.
    expect(out).toContain("rgb(212,175,55)");
  });

  const ARTWORK: Record<string, string> = {
    classic: "board-classic.svg",
    geometric: "board-geometric.svg",
    aladdin: "board-aladdin.svg",
    bazaar: "board-bazaar.svg",
    rug: "board-rug.svg",
    mosaic: "board-mosaic.svg",
    sindbad: "board-sindbad.svg",
    "hex-classic": "board-hex-classic.svg",
    "hex-signature": "board-hex-signature.svg",
    "hex-geometric": "board-hex-geometric.svg",
    "hex-aladdin": "board-hex-aladdin.svg",
    "hex-bazaar": "board-hex-bazaar.svg",
    "hex-rug": "board-hex-rug.svg",
    "hex-mosaic": "board-hex-mosaic.svg",
    "hex-sindbad": "board-hex-sindbad.svg",
  };

  it("lists only shades the artwork really uses, and changes every one of them", () => {
    expect(Object.keys(BOARD_SEAT_SHADES).sort()).toEqual(Object.keys(ARTWORK).sort());
    for (const [key, file] of Object.entries(ARTWORK)) {
      const svg = readFileSync(join(__dirname, "../../designs", file), "utf8");
      const normalized = (text: string) => text.toLowerCase().replace(/\s+/g, "");
      const recolored = normalized(recolorBoardSvg(svg, BOARD_SEAT_SHADES[key]));
      for (const shades of Object.values(BOARD_SEAT_SHADES[key]))
        for (const shade of shades) {
          expect(normalized(svg), `${shade} in ${file}`).toContain(normalized(shade));
          expect(recolored, `${shade} left in ${file}`).not.toContain(normalized(shade));
        }
    }
  });

  it("moves the raster board's inks onto the palette, keeping blends with the paper", () => {
    const paper = [253, 251, 247];
    const half = LUDO_INKS.green.map((v, i) => Math.round((v + paper[i]) / 2));
    const pixels = new Uint8ClampedArray([...LUDO_INKS.green, 255, ...half, 255, ...paper, 255]);
    expect(classifyLudoInk(half[0], half[1], half[2])).toBe("green");
    recolorLudoInkPixels(pixels);
    const target = [1, 3, 5].map((i) => parseInt(COLOR_BLIND_COLORS.green.slice(i, i + 2), 16));
    expect(Array.from(pixels.slice(0, 3))).toEqual(target);
    // Paper is untouched.
    expect(Array.from(pixels.slice(8, 11))).toEqual(paper);
  });
});
