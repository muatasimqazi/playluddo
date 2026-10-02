// Warms the JS chunk and textures the live 3D table needs, so the
// transition from the entrance's static image into a real room/practice
// game doesn't pay for both at once. Safe to call speculatively — it
// only downloads and decodes, it never mounts anything.
import { useEffect } from "react";
import boardArtwork from "@/designs/board-design.webp";
import classicBoardArtwork from "@/designs/board-classic.svg";
import geometricBoardArtwork from "@/designs/board-geometric.svg";
import aladdinBoardArtwork from "@/designs/board-aladdin.svg";
import bazaarBoardArtwork from "@/designs/board-bazaar.svg";
import lampArtwork from "@/designs/lamp.svg";
import snakeArtwork from "@/designs/snake-and-ladder/snakes-and-ladders-board.svg";

let started = false;

const BOARD_IMAGE_SOURCES = [
  boardArtwork.src,
  classicBoardArtwork.src as string,
  geometricBoardArtwork.src as string,
  aladdinBoardArtwork.src as string,
  bazaarBoardArtwork.src as string,
  snakeArtwork.src as string,
];

export function preloadBoardScene() {
  if (started) return;
  started = true;
  void Promise.all([
    import("@react-three/drei"),
    import("@react-three/fiber"),
    import("three"),
    import("@/components/simulator/SimulatorScene"),
  ]).then(([{ useTexture }, { useLoader }, { ImageLoader }]) => {
    // Board artwork is loaded as plain images (see BoardObject), so it has
    // to be warmed through the same loader to share its cache.
    for (const src of BOARD_IMAGE_SOURCES) useLoader.preload(ImageLoader, src);
    for (const src of [
      lampArtwork.src as string,
      "/textures/board-wood.webp",
      // The apartment room behind the table (see Apartment.tsx) — by far
      // the biggest chunk of what the scene is waiting on the first time
      // it mounts, so it's the one most worth warming ahead of time.
      "/textures/room-walnut.jpg",
      "/textures/floor.jpg",
      "/textures/couch-fabric.webp",
      "/textures/room-rug.jpg",
      "/textures/seattle-skyline.webp",
      "/textures/cactus.webp",
      "/textures/bookshelf.jpg",
      "/textures/paintings.jpg",
      "/textures/island.jpg",
      "/textures/table-top.webp",
      "/textures/pillow-1.jpg",
      "/textures/painting-2.webp",
      "/textures/stool.webp",
      "/textures/curtains.jpg",
    ])
      useTexture.preload(src);
  });
}

// Idle time only, so this never competes with a page's own first paint or
// interactivity for bandwidth or the main thread — safe to call from any
// entry point (the entrance, a shared room link, Table Together) since
// preloadBoardScene() itself only ever does its real work once.
export function usePreloadBoardScene() {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
    const handle = idle(preloadBoardScene);
    return () => cancelIdle(handle);
  }, []);
}
