import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// designs/board-boba.svg is exported from a design tool, so a re-export
// can bring back the layout it was drawn in. The table needs each seat's
// flavour in the game's corner (components/arena/boardLayout.ts BASE_AREA:
// red top-left, green top-right, yellow bottom-right, blue bottom-left) and
// the 15x15 grid filling the image, without the pearl-studded margin.
const svg = readFileSync(join(__dirname, "../../designs/board-boba.svg"), "utf8");

// Each flavour, then the pastel its yard is tinted with: strawberry, matcha,
// mango, taro.
const RED = ["#EE7799", "#FCDDE6"];
const GREEN = ["#78B062", "#DDEFD3"];
const YELLOW = ["#F2A33A", "#FDE8C8"];
const BLUE = ["#9B7BC8", "#E4D8F3"];

/** The yard's pastel and its cup's flavour. */
const yard = (transform: string | null) => {
  const open = transform ? `<g transform="${transform}">` : '<g>\n<rect width="600"';
  const start = svg.indexOf(open);
  expect(start, `yard group ${open}`).toBeGreaterThan(-1);
  const group = svg.slice(start);
  return [
    group.match(/<use href="#bb-cup" fill="(#[0-9A-F]{6})"/)?.[1],
    group.match(/<rect width="600" height="600" fill="(#[0-9A-F]{6})"/)?.[1],
  ];
};

describe("the Boba board artwork", () => {
  it("crops to the 15x15 grid, leaving out the pearl-studded margin", () => {
    expect(svg).toMatch(/viewBox="0 0 1500 1500"/);
  });

  it("puts each seat's flavour in the game's corner", () => {
    expect(yard(null)).toEqual(RED);
    expect(yard("translate(900 0)")).toEqual(GREEN);
    expect(yard("translate(900 900)")).toEqual(YELLOW);
    expect(yard("translate(0 900)")).toEqual(BLUE);
  });

  it("runs each home column in its seat's flavour", () => {
    expect(svg).toContain(`<rect x="700" y="100" width="100" height="500" fill="${GREEN[0]}">`);
    expect(svg).toContain(`<rect x="900" y="700" width="500" height="100" fill="${YELLOW[0]}">`);
    expect(svg).toContain(`<rect x="700" y="900" width="100" height="500" fill="${BLUE[0]}">`);
    expect(svg).toContain(`<rect x="100" y="700" width="500" height="100" fill="${RED[0]}">`);
  });
});
