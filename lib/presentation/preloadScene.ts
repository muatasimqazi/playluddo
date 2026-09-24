// Warms the JS chunk and textures the live 3D table needs, so the
// transition from the entrance's static image into a real room/practice
// game doesn't pay for both at once. Safe to call speculatively — it
// only downloads and decodes, it never mounts anything.
import boardArtwork from "@/designs/board-design.png";
import classicBoardArtwork from "@/designs/board-classic.svg";
import geometricBoardArtwork from "@/designs/board-geometric.svg";
import aladdinBoardArtwork from "@/designs/board-aladdin.svg";
import lampArtwork from "@/designs/lamp.svg";
import snakeArtwork from "@/designs/snake-and-ladder/board.svg";

let started = false;

export function preloadBoardScene() {
  if (started) return;
  started = true;
  void Promise.all([
    import("@react-three/drei"),
    import("@/components/simulator/SimulatorScene"),
  ]).then(([{ useTexture }]) => {
    for (const src of [
      boardArtwork.src,
      classicBoardArtwork.src as string,
      geometricBoardArtwork.src as string,
      aladdinBoardArtwork.src as string,
      snakeArtwork.src as string,
      lampArtwork.src as string,
      "/textures/board-wood.jpg",
      // The apartment room behind the table (see Apartment.tsx) — by far
      // the biggest chunk of what the scene is waiting on the first time
      // it mounts, so it's the one most worth warming ahead of time.
      "/textures/room-walnut.jpg",
      "/textures/floor.jpg",
      "/textures/couch-fabric.jpg",
      "/textures/room-rug.jpg",
      "/textures/seattle-skyline.jpg",
      "/textures/cactus.jpg",
      "/textures/bookshelf.jpg",
      "/textures/paintings.jpg",
      "/textures/island.jpg",
      "/textures/table-top.jpg",
      "/textures/pillow-1.jpg",
      "/textures/painting-2.png",
      "/textures/stool.jpg",
      "/textures/curtains.jpg",
    ])
      useTexture.preload(src);
  });
}
