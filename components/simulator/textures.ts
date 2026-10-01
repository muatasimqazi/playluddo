import * as THREE from "three";
import {
  classifyLudoInk,
  LUDO_INKS,
  recolorLudoInkPixels,
  symbolOutline,
  type SeatSymbol,
} from "@/lib/presentation/accessibility";
import { recoloredArtworkUrl } from "@/lib/presentation/recoloredArtwork";

function texture(canvas: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

function gradeLudoInks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
) {
  const pixels = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const ink = classifyLudoInk(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
    if (!ink) continue;
    const target = LUDO_INKS[ink];
    const spread =
      (Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) -
        Math.min(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])) /
      255;

    // Stronger source color receives more of the richer target ink while
    // antialiased edges retain their natural soft transition into white.
    const amount = Math.min(0.92, (spread - 0.16) * 1.15 * strength);
    pixels.data[i] = Math.round(pixels.data[i] * (1 - amount) + target[0] * amount);
    pixels.data[i + 1] = Math.round(
      pixels.data[i + 1] * (1 - amount) + target[1] * amount,
    );
    pixels.data[i + 2] = Math.round(
      pixels.data[i + 2] * (1 - amount) + target[2] * amount,
    );
  }
  ctx.putImageData(pixels, 0, 0);
}

/** A small forked-tongue silhouette, shared by every animated snake head. */
export function makeTongueTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the tongue texture.");
  ctx.strokeStyle = "#c22b2b";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // A short base tapering into two thin curved prongs near the tip.
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 24);
  ctx.lineTo(38, 24);
  ctx.stroke();
  ctx.lineWidth = 3.5;
  for (const dy of [-9, 9]) {
    ctx.beginPath();
    ctx.moveTo(34, 24);
    ctx.quadraticCurveTo(50, 24, 62, 24 + dy);
    ctx.stroke();
  }
  return texture(canvas);
}

/**
 * A player's name, drawn to sit flat on their base quadrant in plain white.
 * A faint dark halo keeps it legible on any of the base colours. Kept small
 * and letter-spaced so it stays unobtrusive. Long names shrink to fit, then
 * ellipsize, so the plate width never has to change per player. Transparent
 * everywhere but the lettering — and the seat's symbol ahead of the name, so
 * whose base it is never rests on colour alone (F5.5).
 */
export function makeNameTexture(name: string, symbol?: SeatSymbol) {
  const width = 512;
  const height = 132;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the name plate.");
  const label = name.trim() || " ";
  // Room for the symbol and the gap after it.
  const symbolSize = symbol ? 30 : 0;
  const symbolGap = symbol ? 14 : 0;
  const maxWidth = width - 140 - symbolSize - symbolGap;
  const family = '500 SIZEpx "Inter", "Helvetica Neue", Arial, sans-serif';
  let size = 48;
  ctx.letterSpacing = "2px";
  ctx.font = family.replace("SIZE", String(size));
  // Shrink to fit the plate, down to a floor; below it, clip with an ellipsis.
  while (size > 26 && ctx.measureText(label).width > maxWidth) {
    size -= 2;
    ctx.font = family.replace("SIZE", String(size));
  }
  let text = label;
  if (ctx.measureText(text).width > maxWidth) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) {
      text = text.slice(0, -1);
    }
    text = `${text}…`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // letterSpacing adds a trailing gap after the last glyph, nudging the
  // visual centre left; shift right by half of one gap to recentre.
  const textWidth = ctx.measureText(text).width;
  const cx = width / 2 + 1 + (symbolSize + symbolGap) / 2;
  const cy = height / 2;
  // A soft dark halo lifts the white off the base colour without a hard edge.
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, cy);
  if (symbol) {
    const sx = cx - textWidth / 2 - symbolGap - symbolSize / 2;
    const radius = symbolSize / 2;
    ctx.beginPath();
    symbolOutline(symbol).forEach(([x, y], i) => {
      const px = sx + x * radius;
      const py = cy - y * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  }
  return texture(canvas);
}

export function makeBoardTexture(
  image: HTMLImageElement,
  crop: "ludo" | "full" = "ludo",
  inkStrength = 1,
  vectorSize = 2048,
  /** F5.5: move the raster board's seat inks onto the colour-blind palette. */
  colorBlind = false,
) {
  // The PNG embeds Adobe RGB (1998). Drawing to an sRGB canvas lets the
  // browser apply that ICC profile before Three uploads the color pixels.
  // Merely labeling the original Adobe RGB bytes as sRGB shifts the ink hues.
  const canvas = document.createElement("canvas");
  // SVG images without explicit pixel dimensions report a small browser
  // default intrinsic size. Rasterize board vectors at texture resolution
  // before uploading them to WebGL so overhead and zoomed views stay crisp.
  // `vectorSize` is chosen by the caller for the screen it will be seen on.
  const vectorSource = /\.svg(?:$|\?)/i.test(image.currentSrc || image.src);
  canvas.width = vectorSource ? vectorSize : image.naturalWidth;
  canvas.height = vectorSource ? vectorSize : image.naturalHeight;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the board artwork.");
  // Explicit destination size, not drawImage(image, 0, 0) — an SVG with no
  // width/height attribute (only a viewBox, like board-classic.svg) has no
  // real intrinsic size, and browsers disagree on the fallback they use for
  // it, so drawing at "natural" size can end up far smaller than the canvas.
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (crop === "ludo") {
    gradeLudoInks(ctx, canvas.width, canvas.height, inkStrength);
    if (colorBlind) {
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      recolorLudoInkPixels(pixels.data);
      ctx.putImageData(pixels, 0, 0);
    }
  }

  // The 2024px artwork has a ~134px print margin around its 15×15 grid
  // (measured from the colored quadrant edges). Cropping exactly that margin
  // makes the printed grid fill the board plane edge to edge, so each printed
  // cell lands at 6/15 = one geometry cell — pieces (placed at gridPoint cell
  // centers) then sit squarely on the printed cells and base nest circles.
  // An earlier 128px guess left the grid slightly small and inset, so pieces
  // drifted off the cells toward the board's edges. Crop only through UVs,
  // preserving the original image and square centers.
  const inset = crop === "full" ? 0 : 134 / 2024;
  const map = texture(canvas);
  map.offset.set(inset, inset);
  map.repeat.set(1 - inset * 2, 1 - inset * 2);
  return map;
}

/**
 * Loads board artwork for "Colour-blind mode" (F5.5). A URL ending in
 * `#seats=<artwork>` is a vector board whose seat colours are rewritten in
 * its SVG source (BOARD_SEAT_SHADES) before the browser rasterizes it; any
 * other URL loads as a plain image. It's a separate loader class so its
 * results sit in their own useLoader cache beside the untouched artwork.
 */
export class SeatRecolorLoader extends THREE.Loader<HTMLImageElement> {
  load(
    url: string,
    onLoad: (image: HTMLImageElement) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) {
    const images = new THREE.ImageLoader(this.manager);
    const [src, artwork] = url.split("#seats=");
    if (!artwork) return images.load(url, onLoad, onProgress, onError);
    recoloredArtworkUrl(src, artwork).then(
      (recolored) => images.load(recolored, onLoad, onProgress, onError),
      (error) => onError?.(error),
    );
  }
}
