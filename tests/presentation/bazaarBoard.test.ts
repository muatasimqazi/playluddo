import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// designs/board-bazaar.svg is exported from a design tool, so a re-export
// can bring back the layout it was drawn in. The table needs each seat's
// yard in the game's corner (components/arena/boardLayout.ts BASE_AREA: red
// top-left, green top-right, yellow bottom-right, blue bottom-left) and the
// 15x15 grid filling the image, with no frame around it.
const svg = readFileSync(join(__dirname, "../../designs/board-bazaar.svg"), "utf8");

// The seat gradients: bz-gR red, bz-gG green, bz-gY yellow, bz-gB blue.
const yardFill = (transform: string | null) => {
  const open = transform ? `<g transform="${transform}">` : "<g>";
  const start = svg.indexOf(open);
  expect(start, `yard group ${open}`).toBeGreaterThan(-1);
  return svg.slice(start).match(/<rect width="600" height="600" fill="url\(#(bz-g[RGYB])\)"/)?.[1];
};

describe("the Bazaar board artwork", () => {
  it("crops to the 15x15 grid, leaving out the frame", () => {
    expect(svg).toMatch(/viewBox="0 0 1500 1500"/);
  });

  it("puts each seat's yard in the game's corner", () => {
    expect(yardFill(null)).toBe("bz-gR");
    expect(yardFill("translate(900 0)")).toBe("bz-gG");
    expect(yardFill("translate(900 900)")).toBe("bz-gY");
    expect(yardFill("translate(0 900)")).toBe("bz-gB");
  });

  it("colours each arm for the seat whose home column runs down it", () => {
    expect(svg).toContain('<rect x="600" y="0" width="300" height="600" fill="url(#bz-gG)">');
    expect(svg).toContain('<rect x="900" y="600" width="600" height="300" fill="url(#bz-gY)">');
    expect(svg).toContain('<rect x="600" y="900" width="300" height="600" fill="url(#bz-gB)">');
    expect(svg).toContain('<rect x="0" y="600" width="600" height="300" fill="url(#bz-gR)">');
  });
});
