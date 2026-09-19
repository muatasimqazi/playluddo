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

export function makeBoardTexture(
  source: THREE.Texture,
  crop: "ludo" | "full" = "ludo",
  inkStrength = 1,
) {
  // The PNG embeds Adobe RGB (1998). Drawing to an sRGB canvas lets the
  // browser apply that ICC profile before Three uploads the color pixels.
  // Merely labeling the original Adobe RGB bytes as sRGB shifts the ink hues.
  const canvas = document.createElement("canvas");
  const image = source.image as HTMLImageElement;
  // SVG images without explicit pixel dimensions report a small browser
  // default intrinsic size. Rasterize board vectors at texture resolution
  // before uploading them to WebGL so overhead and zoomed views stay crisp.
  const vectorSource = /\.svg(?:$|\?)/i.test(image.currentSrc || image.src);
  canvas.width = vectorSource ? 2048 : image.naturalWidth;
  canvas.height = vectorSource ? 2048 : image.naturalHeight;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the board artwork.");
  ctx.drawImage(image, 0, 0);
  if (crop === "ludo")
    gradeLudoInks(ctx, canvas.width, canvas.height, inkStrength);

  // The 2024px artwork has a 128px print margin around its 15×15 grid.
  // Crop only through UVs, preserving the original image and square centers.
  const inset = crop === "full" ? 0 : 128 / 2024;
  const map = texture(canvas);
  map.offset.set(inset, inset);
  map.repeat.set(1 - inset * 2, 1 - inset * 2);
  return map;
}
