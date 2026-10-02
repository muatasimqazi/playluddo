"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n";
import {
  finishNavigation,
  isLoading,
  startNavigation,
  subscribeProgress,
} from "@/lib/navigation/progress";

// Anything quicker needs no answer; showing one would only flicker.
const SHOW_AFTER_MS = 150;
// A navigation that never lands (offline, say) stops claiming to load.
const GIVE_UP_MS = 15000;
// Long enough for the bar to fill and fade (globals.css, .loading-bar.is-done).
const FINISH_MS = 400;

/** Finishes a navigation once the route it was heading for is showing. */
function RouteWatcher() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    finishNavigation();
  }, [pathname, search]);
  return null;
}

/**
 * A thin bar along the top of the screen while the app is busy with
 * something the player asked for: a link, a router.push, or an action passed
 * to trackProgress (lib/navigation/progress.ts). It appears only once the
 * wait is noticeable, creeps along, and fills as the work lands, and the
 * cursor shows progress meanwhile, so a slow tap doesn't look ignored.
 */
export function LoadingBar() {
  const t = useT();
  const loading = useSyncExternalStore(subscribeProgress, isLoading, () => false);
  // This load has gone on long enough to show.
  const [slow, setSlow] = useState(false);

  // Link taps the app handles itself (next/link): not new tabs, downloads,
  // modified clicks or other sites.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      if (anchor.origin !== window.location.origin) return;
      startNavigation(anchor.href);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const show = setTimeout(() => setSlow(true), SHOW_AFTER_MS);
    const giveUp = setTimeout(finishNavigation, GIVE_UP_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [loading]);
  useEffect(() => {
    if (loading || !slow) return;
    const finish = setTimeout(() => setSlow(false), FINISH_MS);
    return () => clearTimeout(finish);
  }, [loading, slow]);

  const phase = !slow ? "idle" : loading ? "running" : "done";
  useEffect(() => {
    document.documentElement.classList.toggle("is-loading", phase === "running");
  }, [phase]);

  return (
    <>
      <Suspense fallback={null}>
        <RouteWatcher />
      </Suspense>
      <div
        className={`loading-bar is-${phase}`}
        role={phase === "running" ? "progressbar" : undefined}
        aria-label={phase === "running" ? t("actions.loading") : undefined}
        aria-hidden={phase !== "running"}
      />
    </>
  );
}
