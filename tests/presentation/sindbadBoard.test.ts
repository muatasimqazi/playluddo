import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// designs/board-sindbad.svg is exported from a design tool, so a re-export
// can bring back the layout it was drawn in. The table needs each seat's
// harbour in the game's corner (components/arena/boardLayout.ts BASE_AREA:
// red top-left, green top-right, yellow bottom-right, blue bottom-left) and
// the 15x15 grid filling the image, without the open-sea margin.
const svg = readFileSync(join(__dirname, "../../designs/board-sindbad.svg"), "utf8");

// The harbour colours: coral red, sea green, amber yellow, ocean blue.
const RED = "#C9473A";
const GREEN = "#2E8B6E";
const YELLOW = "#E0A03A";
const BLUE = "#2C5D9E";

const yardFill = (transform: string | null) => {
  const open = transform ? `<g transform="${transform}">` : "<g>\n<rect width=\"600\"";
  const start = svg.indexOf(open);
  expect(start, `yard group ${open}`).toBeGreaterThan(-1);
  return svg.slice(start).match(/<rect width="600" height="600" fill="(#[0-9A-F]{6})"/)?.[1];
};

describe("the Sindbad board artwork", () => {
  it("crops to the 15x15 grid, leaving out the open-sea margin", () => {
    expect(svg).toMatch(/viewBox="0 0 1500 1500"/);
  });

  it("puts each seat's harbour in the game's corner", () => {
    expect(yardFill(null)).toBe(RED);
    expect(yardFill("translate(900 0)")).toBe(GREEN);
    expect(yardFill("translate(900 900)")).toBe(YELLOW);
    expect(yardFill("translate(0 900)")).toBe(BLUE);
  });

  it("runs each home column in its seat's colour", () => {
    expect(svg).toContain(`<rect x="700" y="100" width="100" height="500" fill="${GREEN}">`);
    expect(svg).toContain(`<rect x="900" y="700" width="500" height="100" fill="${YELLOW}">`);
    expect(svg).toContain(`<rect x="700" y="900" width="100" height="500" fill="${BLUE}">`);
    expect(svg).toContain(`<rect x="100" y="700" width="500" height="100" fill="${RED}">`);
  });
});
