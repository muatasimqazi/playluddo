"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

/**
 * The app-wide "something is loading" signal behind the bar along the top of
 * the screen (components/LoadingBar.tsx), so a tap that takes a moment is
 * answered straight away instead of inviting another tap.
 *
 * Navigation drives it on its own: LoadingBar starts it for link taps and
 * finishes it when the route changes, and useProgressRouter() starts it for
 * router.push/replace. A slow action can opt in with trackProgress().
 */

type Listener = () => void;

let navigating = false;
let actions = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeProgress(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isLoading() {
  return navigating || actions > 0;
}

/** True when `href` is where the app already is, so following it loads nothing. */
export function isCurrentUrl(href: string) {
  try {
    const next = new URL(href, window.location.href);
    return (
      next.origin === window.location.origin &&
      next.pathname === window.location.pathname &&
      next.search === window.location.search
    );
  } catch {
    return true;
  }
}

export function startNavigation(href: string) {
  if (navigating || isCurrentUrl(href)) return;
  navigating = true;
  emit();
}

export function finishNavigation() {
  if (!navigating) return;
  navigating = false;
  emit();
}

/** Shows the loading bar for as long as `work` takes (only once it's slow). */
export async function trackProgress<T>(work: Promise<T>): Promise<T> {
  actions += 1;
  emit();
  try {
    return await work;
  } finally {
    actions -= 1;
    emit();
  }
}

/** useRouter(), with push and replace showing the loading bar until the route changes. */
export function useProgressRouter() {
  const router = useRouter();
  return useMemo(
    () => ({
      ...router,
      push: (...args: Parameters<typeof router.push>) => {
        startNavigation(args[0]);
        router.push(...args);
      },
      replace: (...args: Parameters<typeof router.replace>) => {
        startNavigation(args[0]);
        router.replace(...args);
      },
    }),
    [router],
  );
}
