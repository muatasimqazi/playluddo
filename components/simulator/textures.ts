import * as THREE from "three";

function texture(canvas: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

export function makeBoardTexture(source: THREE.Texture) {
  // The PNG embeds Adobe RGB (1998). Drawing to an sRGB canvas lets the
  // browser apply that ICC profile before Three uploads the color pixels.
  // Merely labeling the original Adobe RGB bytes as sRGB shifts the ink hues.
  const canvas = document.createElement("canvas");
  const image = source.image as HTMLImageElement;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) throw new Error("Could not prepare the board artwork.");
  ctx.drawImage(image, 0, 0);

  // The 2024px artwork has a 128px print margin around its 15×15 grid.
  // Crop only through UVs, preserving the original image and square centers.
  const inset = 128 / 2024;
  const map = texture(canvas);
  map.offset.set(inset, inset);
  map.repeat.set(1 - inset * 2, 1 - inset * 2);
  return map;
}

export function makeFabricTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#bdbab0";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 128; i += 2) {
    ctx.fillStyle = i % 4 ? "#aaa79e" : "#d7d4ca";
    ctx.fillRect(i, 0, 1, 128);
    ctx.fillStyle = "#ffffff35";
    ctx.fillRect(0, i, 128, 1);
  }
  const map = texture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(5, 5);
  return map;
}
