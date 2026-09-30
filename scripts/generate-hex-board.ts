/**
 * Writes the 5-6 player hexagonal boards (F5.2), one per board style, to
 * designs/board-hex-<style>.svg, from lib/presentation/hexArtwork.ts. Every
 * style draws its cells, bases and nest slots at the positions
 * lib/presentation/hexBoard.ts places pawns on, so a freshly generated print
 * always lines up.
 *
 * The files may then be restyled by hand, so this won't overwrite one that
 * exists unless asked to:
 *
 *   npm run board:hex              create any that are missing
 *   npm run board:hex -- --force   regenerate them all (discards hand edits)
 *
 * tests/presentation/hexBoard.test.ts checks every file's cells, bases and
 * nest slots (by id) still sit where the pawns are placed.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HEX_BOARD_FILE, HEX_BOARD_STYLES, hexBoardSvg } from "../lib/presentation/hexArtwork";

const force = process.argv.includes("--force");
for (const style of HEX_BOARD_STYLES) {
  const target = join(__dirname, "..", "designs", HEX_BOARD_FILE[style]);
  if (existsSync(target) && !force) {
    console.log(`Kept ${HEX_BOARD_FILE[style]} (it exists and may have been restyled by hand).`);
  } else {
    writeFileSync(target, hexBoardSvg(style));
    console.log(`Wrote ${HEX_BOARD_FILE[style]}`);
  }
}
if (!force) console.log("Run `npm run board:hex -- --force` to regenerate every file, discarding hand edits.");
