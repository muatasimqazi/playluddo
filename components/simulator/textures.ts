import * as THREE from "three";

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
  const inks = {
    red: [226, 38, 46],
    green: [49, 166, 91],
    blue: [34, 76, 158],
    yellow: [242, 196, 0],
  } as const;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const r = pixels.data[i] / 255;
    const g = pixels.data[i + 1] / 255;
    const b = pixels.data[i + 2] / 255;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread < 0.22) continue;

    let target: readonly [number, number, number] | undefined;
    if (r > 0.68 && g > 0.58 && b < 0.48) target = inks.yellow;
    else if (r > g * 1.45 && r > b * 1.35) target = inks.red;
    else if (g > r * 1.16 && g > b * 1.12) target = inks.green;
    else if (b > r * 1.3 && b > g * 1.18) target = inks.blue;
    if (!target) continue;

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
 * everywhere but the lettering.
 */
export function makeNameTexture(name: string) {
  const width = 512;
  const height = 132;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the name plate.");
  const label = name.trim() || " ";
  const maxWidth = width - 140;
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
  const cx = width / 2 + 1;
  const cy = height / 2;
  // A soft dark halo lifts the white off the base colour without a hard edge.
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, cy);
  return texture(canvas);
}

export function makeBoardTexture(
  image: HTMLImageElement,
  crop: "ludo" | "full" = "ludo",
  inkStrength = 1,
  vectorSize = 2048,
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
  if (crop === "ludo")
    gradeLudoInks(ctx, canvas.width, canvas.height, inkStrength);

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
