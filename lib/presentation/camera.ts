import type { CameraView, Point } from "./board";

/** Preserve enough horizontal field of view for the whole board on narrow screens. */
export function cameraFraming(
  view: CameraView,
  aspect: number,
  preview = false,
) {
  const portrait = aspect < 0.9;
  const views: Record<CameraView, Point> = {
    play: portrait ? [0, 8.1, 9.4] : [0, 6.2, 7.4],
    overhead: portrait ? [0, 10.7, 0.01] : [0, 12, 0.01],
    table: [8.2, 9.5, 10.7],
    north: [0, 6.8, -8.6],
    east: [8.6, 6.8, 0],
    west: [-8.6, 6.8, 0],
  };
  const horizontalFov = (42 * Math.PI) / 180;
  const fov = Math.max(
    preview ? 42 : 38,
    (2 *
      Math.atan(Math.tan(horizontalFov / 2) / Math.max(0.25, aspect)) *
      180) /
      Math.PI,
  );
  return {
    eye: preview ? ([8.6, 8.6, 11.7] as Point) : views[view],
    target: [
      preview ? -1 : 0,
      0.1,
      view === "play" && !preview ? 0.25 : 0,
    ] as Point,
    fov,
  };
}
