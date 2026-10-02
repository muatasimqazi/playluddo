"use client";

import { useEffect, useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import { trackError } from "@/lib/analytics";
import { webglAvailable } from "@/lib/analytics/webgl";

/**
 * `webgl_unavailable`, once, when the browser can't draw the 3D table.
 *
 * Not from the Canvas `fallback`: React Three Fiber renders that inside the
 * <canvas> element on every browser, so anything there mounts for everyone.
 */
export function useReportMissingWebGL() {
  useEffect(() => {
    if (!webglAvailable()) trackError("three_d", "webgl_unavailable");
  }, []);
}

/**
 * `context_lost` when the GPU drops the table's context mid-game. Render it
 * inside the Canvas: the listener goes when the table closes, before React
 * Three Fiber forces its own context loss to free the GPU.
 */
export function ReportContextLoss() {
  const canvas = useThree((state) => state.gl.domElement);
  useLayoutEffect(() => {
    const onLost = () => trackError("three_d", "context_lost");
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, [canvas]);
  return null;
}
