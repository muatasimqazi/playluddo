"use client";

import { useEffect, useState } from "react";
import type { Quality } from "../presentation/board";

const STEPS: readonly Quality[] = ["low", "medium", "high"];
const SAMPLE_MS = 4000;
/** Comfortably smooth: worth trying the next preset up. */
const STEP_UP_FPS = 55;
/** Visibly struggling: go back down and stay there. */
const STEP_DOWN_FPS = 30;

/**
 * The next preset from a frame-rate sample, or null to stay put. Steps up
 * while there's headroom, down once when struggling; never oscillates.
 */
export function nextQuality(current: Quality, fps: number, steppedDown: boolean): Quality | null {
  const index = STEPS.indexOf(current);
  if (fps < STEP_DOWN_FPS && index > 0) return STEPS[index - 1];
  if (fps >= STEP_UP_FPS && !steppedDown && index >= 0 && index < STEPS.length - 1) return STEPS[index + 1];
  return null;
}

/**
 * Picks a rendering preset for a display whose power is unknown, like the
 * Party screen on a TV browser (docs/COMPETITIVE_ROADMAP.md P4): starts at
 * the lowest and steps up while the frame rate allows.
 */
export function useAdaptiveQuality(enabled: boolean): Quality {
  const [quality, setQuality] = useState<Quality>("low");
  useEffect(() => {
    if (!enabled) return;
    let frames = 0;
    let raf = 0;
    let stepped = false;
    let current: Quality = "low";
    let started = performance.now();
    const tick = () => {
      frames++;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const timer = setInterval(() => {
      // A hidden tab doesn't draw; its sample means nothing.
      if (document.hidden) {
        frames = 0;
        started = performance.now();
        return;
      }
      const fps = (frames * 1000) / (performance.now() - started);
      frames = 0;
      started = performance.now();
      const next = nextQuality(current, fps, stepped);
      if (!next) return;
      if (STEPS.indexOf(next) < STEPS.indexOf(current)) stepped = true;
      current = next;
      setQuality(next);
    }, SAMPLE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [enabled]);
  return quality;
}
