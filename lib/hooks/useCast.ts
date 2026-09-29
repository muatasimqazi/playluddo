"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Google Cast via the W3C Presentation API. The phone presents a URL (the TV
// `/screen` view of a room) to a Cast-compatible display; the phone stays in
// the room as a controller. Note: this finds Chromecast-built-in displays or a
// Chromecast dongle — a bare LG webOS TV is not a Cast receiver, so nothing
// will appear for it. The button is shown only when a device is actually
// available, so it stays hidden where casting can't work.
//
// Typed loosely against `any`: PresentationRequest/Connection aren't in the
// stable DOM lib across TS versions, and we only touch a small, guarded surface.

type CastStatus = "unsupported" | "idle" | "connecting" | "connected";

export interface Cast {
  /** The Presentation API exists in this browser. */
  supported: boolean;
  /** A compatible cast device is currently available to pick. */
  available: boolean;
  connecting: boolean;
  connected: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

export function useCast(url: string | null): Cast {
  const [status, setStatus] = useState<CastStatus>("unsupported");
  const [available, setAvailable] = useState(false);
  const requestRef = useRef<any>(null);
  const connectionRef = useRef<any>(null);

  useEffect(() => {
    if (!url || typeof window === "undefined") return;
    const w = window as any;
    if (typeof w.PresentationRequest !== "function") {
      setStatus("unsupported");
      return;
    }
    let cancelled = false;
    let availabilityObj: any = null;
    let request: any;
    try {
      request = new w.PresentationRequest([url]);
    } catch {
      setStatus("unsupported");
      return;
    }
    requestRef.current = request;
    setStatus("idle");
    if (typeof request.getAvailability === "function") {
      request
        .getAvailability()
        .then((a: any) => {
          if (cancelled) return;
          availabilityObj = a;
          setAvailable(!!a.value);
          a.onchange = () => setAvailable(!!a.value);
        })
        .catch(() => {
          // Some platforms don't support continuous availability monitoring;
          // show the button optimistically — start() still prompts the picker.
          if (!cancelled) setAvailable(true);
        });
    } else {
      setAvailable(true);
    }
    return () => {
      cancelled = true;
      if (availabilityObj) availabilityObj.onchange = null;
    };
  }, [url]);

  const start = useCallback(async () => {
    const request = requestRef.current;
    if (!request) return;
    try {
      setStatus("connecting");
      const connection = await request.start();
      connectionRef.current = connection;
      setStatus("connected");
      const done = () => setStatus("idle");
      connection.onclose = done;
      connection.onterminate = done;
    } catch {
      // The user dismissed the picker or chose no device.
      setStatus("idle");
    }
  }, []);

  const stop = useCallback(() => {
    try {
      connectionRef.current?.terminate?.();
    } catch {
      /* already gone */
    }
    connectionRef.current = null;
    setStatus("idle");
  }, []);

  return {
    supported: status !== "unsupported",
    available,
    connecting: status === "connecting",
    connected: status === "connected",
    start,
    stop,
  };
}
