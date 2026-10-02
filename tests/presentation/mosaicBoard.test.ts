import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// designs/board-mosaic.svg is exported from a design tool, so a re-export
// can bring back the layout it was drawn in. The table needs each seat's
// yard in the game's corner (components/arena/boardLayout.ts BASE_AREA: red
// top-left, green top-right, yellow bottom-right, blue bottom-left) and the
// 15x15 grid filling the image, without the tiled border.
const svg = readFileSync(join(__dirname, "../../designs/board-mosaic.svg"), "utf8");

// The seat tile patterns: ia-tR red, ia-tG green, ia-tY yellow, ia-tB blue.
const yardFill = (transform: string | null) => {
  const open = transform ? `<g transform="${transform}">` : "<g>\n<rect width=\"600\"";
  const start = svg.indexOf(open);
  expect(start, `yard group ${open}`).toBeGreaterThan(-1);
  return svg.slice(start).match(/<rect width="600" height="600" fill="url\(#(ia-t[RGYB])\)"/)?.[1];
};

describe("the Mosaic board artwork", () => {
  it("crops to the 15x15 grid, leaving out the tiled border", () => {
    expect(svg).toMatch(/viewBox="0 0 1500 1500"/);
  });

  it("puts each seat's yard in the game's corner", () => {
    expect(yardFill(null)).toBe("ia-tR");
    expect(yardFill("translate(900 0)")).toBe("ia-tG");
    expect(yardFill("translate(900 900)")).toBe("ia-tY");
    expect(yardFill("translate(0 900)")).toBe("ia-tB");
  });

  it("runs each home column in its seat's glaze", () => {
    expect(svg).toContain('<rect x="700" y="100" width="100" height="500" fill="#1A978D">');
    expect(svg).toContain('<rect x="900" y="700" width="500" height="100" fill="#E0A637">');
    expect(svg).toContain('<rect x="700" y="900" width="100" height="500" fill="#2F5BBE">');
    expect(svg).toContain('<rect x="100" y="700" width="500" height="100" fill="#C2533A">');
  });
});
