"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar } from "@capacitor/status-bar";
import { isNativeApp } from "@/lib/native";

/**
 * App-shell behavior that only applies inside the iOS/Android app
 * (Capacitor); renders nothing and does nothing on the web.
 * - Full screen: the status bar is hidden, as in most games.
 * - The launch splash stays up until the first screen has rendered
 *   (capacitor.config.ts auto-hides it after a few seconds regardless).
 * - `html.native-app` lets CSS turn off web-only touch behaviors.
 * - Links the app is opened with (e.g. a shared luddohouse.com room link,
 *   once universal links are set up) open that screen in-app.
 */
export function NativeShell() {
  const router = useRouter();
  useEffect(() => {
    if (!isNativeApp()) return;
    document.documentElement.classList.add("native-app");
    void StatusBar.hide().catch(() => {});
    void SplashScreen.hide().catch(() => {});
    const listener = App.addListener("appUrlOpen", ({ url }) => {
      try {
        const { pathname, search } = new URL(url);
        router.push(`${pathname}${search}`);
      } catch {
        // Not a link we can route; stay where we are.
      }
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [router]);
  return null;
}
