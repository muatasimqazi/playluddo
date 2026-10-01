"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createCastLink } from "@/lib/supabase/rpc";
import { webUrl } from "@/lib/native";

// Google Cast via the W3C Presentation API. The phone presents a URL (the TV
// `/screen` view of a room) to a Cast-compatible display; the phone stays in
// the room and keeps playing. The TV opens that page in a browser of its own,
// as a stranger to the room, so the URL carries a cast token from this seat
// (supabase/migrations/20260930150000_cast_to_tv.sql) that the TV trades for
// read-only access. The token is fetched once a cast device is available, so
// start() can still run inside the tap that asked for it. Note: this finds Chromecast-built-in displays or a
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

/** Cast a room's table to a TV; null (offline play) turns it off. */
export function useCast(roomId: string | null): Cast {
  const [status, setStatus] = useState<CastStatus>("unsupported");
  const [available, setAvailable] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const connectionRef = useRef<any>(null);

  useEffect(() => {
    if (!roomId || typeof window === "undefined") return;
    // Availability depends on the display, not the query string, so the
    // tokenless URL is enough to watch for one.
    const url = webUrl(`/screen?id=${roomId}`);
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
  }, [roomId]);

  // Ready the token as soon as there's somewhere to cast to.
  useEffect(() => {
    tokenRef.current = null;
    if (!roomId || !available) return;
    let cancelled = false;
    void createCastLink(createClient(), roomId)
      .then(({ token }) => {
        if (!cancelled) tokenRef.current = token;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId, available]);

  const start = useCallback(async () => {
    const w = window as any;
    if (!roomId || typeof w.PresentationRequest !== "function") return;
    try {
      setStatus("connecting");
      const token = tokenRef.current ?? (await createCastLink(createClient(), roomId)).token;
      tokenRef.current = token;
      const request = new w.PresentationRequest([
        webUrl(`/screen?id=${roomId}&cast=${encodeURIComponent(token)}`),
      ]);
      const connection = await request.start();
      connectionRef.current = connection;
      setStatus("connected");
      const done = () => setStatus("idle");
      connection.onclose = done;
      connection.onterminate = done;
    } catch {
      // The user dismissed the picker, chose no device, or has no seat here.
      setStatus("idle");
    }
  }, [roomId]);

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
