"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const KEY = "luddo-shake-to-roll";
// m/s² of movement, gravity excluded: a deliberate shake, not a bump.
const THRESHOLD = 18;
const COOLDOWN_MS = 1500;

type MotionPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

function readEnabled() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/**
 * Optional shake to roll for Party Mode phones (docs/COMPETITIVE_ROADMAP.md
 * P3). Off until the player turns it on; iOS asks for motion permission at
 * that tap. Remembered per device, and only listening while `active`.
 */
export function useShakeToRoll(active: boolean, onShake: () => void) {
  const available = useSyncExternalStore(
    subscribe,
    () => typeof DeviceMotionEvent !== "undefined",
    () => false,
  );
  const stored = useSyncExternalStore(subscribe, readEnabled, () => false);
  const [denied, setDenied] = useState(false);
  const enabled = available && stored && !denied;

  const onShakeRef = useRef(onShake);
  useEffect(() => {
    onShakeRef.current = onShake;
  });
  useEffect(() => {
    if (!enabled || !active) return;
    let last = 0;
    const handle = (e: DeviceMotionEvent) => {
      const a = e.acceleration;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const now = Date.now();
      if (Math.hypot(a.x, a.y, a.z) < THRESHOLD || now - last < COOLDOWN_MS) return;
      last = now;
      onShakeRef.current();
    };
    window.addEventListener("devicemotion", handle);
    return () => window.removeEventListener("devicemotion", handle);
  }, [enabled, active]);

  async function toggle() {
    const next = !enabled;
    if (next) {
      const request = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
      if (request) {
        const answer = await request().catch(() => "denied" as const);
        if (answer !== "granted") {
          setDenied(true);
          return;
        }
      }
      setDenied(false);
    }
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {}
    listeners.forEach((l) => l());
  }

  return { available, enabled, toggle };
}
