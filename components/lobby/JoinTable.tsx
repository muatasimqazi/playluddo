"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { getRoomInvite, joinRoomById, RpcError, type RoomInvite } from "@/lib/supabase/rpc";
import { useAgeCheck } from "@/components/lobby/AgeCheck";
import { ProfilePanel } from "@/components/auth/ProfilePanel";
import { TableLoading } from "@/components/simulator/TableLoading";
import { Icon } from "@/components/simulator/Icon";
import { RoomNotice } from "./RoomNotice";
import "@/components/simulator/simulator.css";

// Remembered across visits so a returning guest doesn't retype their name.
const NAME_KEY = "luddo-player-name";

function rememberedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * The screen a friend lands on when they open a shared room link and don't
 * have a seat yet: who invited them, and just a name to join with. No
 * sign-in required — they're already an anonymous guest by the time this
 * shows (ensureSession), and signing in from the profile button is optional.
 */
export function JoinTable({ roomId, onJoined }: { roomId: string; onJoined: () => void }) {
  const client = useMemo(() => createClient(), []);
  const [invite, setInvite] = useState<RoomInvite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(rememberedName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const age = useAgeCheck();
  // Stable: ProfilePanel re-subscribes to auth whenever this changes. A
  // signed-in profile name only fills an empty field, never overwrites.
  const fillNameFromProfile = useCallback(
    (value: string) => setName((current) => current || value),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void ensureSession(client)
      .then(() => getRoomInvite(client, roomId))
      .then((value) => {
        if (cancelled) return;
        // Already seated (e.g. joined from another tab meanwhile): go straight in.
        if (value.isSeated) onJoined();
        else setInvite(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof RpcError ? err.code : "UNKNOWN");
      });
    return () => {
      cancelled = true;
    };
  }, [client, roomId, onJoined]);

  async function join() {
    const displayName = name.trim();
    if (!displayName) {
      setError("What should we call you at the table?");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await joinRoomById(client, roomId, displayName);
      try {
        localStorage.setItem(NAME_KEY, displayName);
      } catch {
        // Remembering the name is a convenience only.
      }
      onJoined();
    } catch (err) {
      if (age.handle(err, () => void join())) {
        setPending(false);
        return;
      }
      const code = err instanceof RpcError ? err.code : "UNKNOWN";
      if (code === "ROOM_FULL" || code === "ALREADY_STARTED" || code === "ROOM_NOT_FOUND") {
        setLoadError(code);
      } else {
        setError("Couldn't take your seat. Check your connection and try again.");
      }
      setPending(false);
    }
  }

  if (loadError) return <RoomNotice code={loadError} />;
  if (!invite) return <TableLoading label="Opening your invitation…" />;
  if (invite.status !== "lobby") return <RoomNotice code="ALREADY_STARTED" />;
  if (invite.seatsTaken >= invite.maxPlayers) return <RoomNotice code="ROOM_FULL" />;

  const gameName = invite.gameType === "ludo" ? "Ludo" : "Snakes & Ladders";
  return (
    <main className="sim-entrance room-lobby-page">
      {age.gate}
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img className="entrance-bg-image" src="/images/entrance-board.webp" alt="" />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <span className="sim-brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            LUDDO<small>HOUSE</small>
          </span>
        </span>
        {/* Optional: a signed-in player joins under their account and profile. */}
        <ProfilePanel onNameChange={fillNameFromProfile} />
      </header>
      <section className="entrance-content room-lobby join-table">
        <span className="eyebrow">YOU&apos;RE INVITED</span>
        <h1>
          Pull up
          <br />a <em>chair.</em>
        </h1>
        <p className="join-table-host">
          {invite.hostName ?? "A friend"} saved you a seat at a {invite.maxPlayers}-player{" "}
          {gameName} table · {invite.seatsTaken} of {invite.maxPlayers} seated.
        </p>
        <form
          className="entrance-form"
          onSubmit={(event) => {
            event.preventDefault();
            void join();
          }}
        >
          <label>
            Your name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={24}
              placeholder="How should we call you?"
              autoComplete="nickname"
            />
          </label>
          <button className="sim-primary" disabled={pending}>
            <span>{pending ? "Taking your seat…" : "Join the table"}</span>
            <Icon name="arrow" />
          </button>
          {error && (
            <p className="lobby-error" role="alert">
              {error}
            </p>
          )}
        </form>
        <p className="join-table-note">
          No account needed. Sign in from the top corner if you&apos;d like to keep your stats.
        </p>
      </section>
    </main>
  );
}
