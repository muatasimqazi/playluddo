"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { getRoomInvite, joinPartyAudience, joinRoomById, RpcError, type RoomInvite } from "@/lib/supabase/rpc";
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
export function JoinTable({
  roomId,
  onJoined,
  onAudience,
}: {
  roomId: string;
  onJoined: () => void;
  /** Party Mode (P6): this phone is in the room's audience. */
  onAudience?: () => void;
}) {
  const client = useMemo(() => createClient(), []);
  const [invite, setInvite] = useState<RoomInvite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(rememberedName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The seats filled up while this phone was choosing a name.
  const [seatsGone, setSeatsGone] = useState(false);
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
        else if (value.isAudience && onAudience) onAudience();
        else setInvite(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof RpcError ? err.code : "UNKNOWN");
      });
    return () => {
      cancelled = true;
    };
  }, [client, roomId, onJoined, onAudience]);

  // A party room with no seat left still takes phones, as audience.
  const audience =
    !!invite?.isParty &&
    !!onAudience &&
    invite.status !== "abandoned" &&
    (invite.partyLocked || seatsGone || invite.status !== "lobby" || invite.seatsTaken >= invite.maxPlayers);

  async function join() {
    const displayName = name.trim();
    if (!displayName) {
      setError("What should we call you at the table?");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (audience) await joinPartyAudience(client, roomId, displayName);
      else await joinRoomById(client, roomId, displayName);
      try {
        localStorage.setItem(NAME_KEY, displayName);
      } catch {
        // Remembering the name is a convenience only.
      }
      if (audience) onAudience?.();
      else onJoined();
    } catch (err) {
      if (age.handle(err, () => void join())) {
        setPending(false);
        return;
      }
      const code = err instanceof RpcError ? err.code : "UNKNOWN";
      if (invite?.isParty && onAudience && (code === "ROOM_FULL" || code === "ALREADY_STARTED" || code === "PARTY_LOCKED")) {
        setSeatsGone(true);
        setError("The last seat just went. You can still join the audience.");
      } else if (code === "PARTY_REMOVED") {
        setError("The VIP removed you from this party table.");
      } else if (code === "SEATS_OPEN") {
        // A seat opened up meanwhile: take it instead.
        setSeatsGone(false);
        setInvite((current) => (current ? { ...current, seatsTaken: current.maxPlayers - 1, status: "lobby" } : current));
        setError("A seat just opened up. Take it!");
      } else if (code === "ROOM_FULL" || code === "ALREADY_STARTED" || code === "ROOM_NOT_FOUND") {
        setLoadError(code);
      } else {
        setError(
          audience
            ? "Couldn't get you into the audience. Check your connection and try again."
            : "Couldn't take your seat. Check your connection and try again.",
        );
      }
      setPending(false);
    }
  }

  if (loadError) return <RoomNotice code={loadError} />;
  if (!invite) return <TableLoading label="Opening your invitation…" />;
  if (!audience && invite.status !== "lobby") return <RoomNotice code="ALREADY_STARTED" />;
  if (!audience && invite.seatsTaken >= invite.maxPlayers) return <RoomNotice code="ROOM_FULL" />;

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
        {audience ? (
          <>
            <span className="eyebrow">PARTY TABLE · {gameName.toUpperCase()}</span>
            <h1>
              Join the
              <br />
              <em>audience.</em>
            </h1>
            <p className="join-table-host">
              {invite.partyLocked ? "The seats are locked" : invite.status === "lobby" ? "Every seat is taken" : "The game has started"}, but you can still
              join in: react on the TV, pick a winner and vote for the moment of the match.
            </p>
          </>
        ) : (
          <>
            <span className="eyebrow">YOU&apos;RE INVITED</span>
            <h1>
              Pull up
              <br />a <em>chair.</em>
            </h1>
            <p className="join-table-host">
              {invite.hostName ?? "A friend"} saved you a seat at a {invite.maxPlayers}-player{" "}
              {gameName} table · {invite.seatsTaken} of {invite.maxPlayers} seated.
            </p>
          </>
        )}
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
            <span>
              {audience
                ? pending
                  ? "Joining…"
                  : "Join the audience"
                : pending
                  ? "Taking your seat…"
                  : "Join the table"}
            </span>
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
