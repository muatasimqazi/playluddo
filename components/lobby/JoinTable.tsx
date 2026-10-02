"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { getRoomInvite, joinPartyAudience, joinRoomById, RpcError, type RoomInvite } from "@/lib/supabase/rpc";
import { useAgeCheck } from "@/components/lobby/AgeCheck";
import { track, trackError } from "@/lib/analytics";
import { ProfilePanel } from "@/components/auth/ProfilePanel";
import { TableLoading } from "@/components/simulator/TableLoading";
import { Icon } from "@/components/simulator/Icon";
import { useI18n } from "@/lib/i18n";
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
  const { t } = useI18n();
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
      setError(t("entrance.nameError"));
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
      if (audience) {
        // Audience phones never hold a seat; this is their only join event.
        track("party_controller_joined", { role: "audience", remote: false }, { once: `party_audience:${roomId}` });
        onAudience?.();
      } else onJoined();
    } catch (err) {
      if (age.handle(err, () => void join())) {
        setPending(false);
        return;
      }
      const code = err instanceof RpcError ? err.code : "UNKNOWN";
      trackError("join", code);
      if (invite?.isParty && onAudience && (code === "ROOM_FULL" || code === "ALREADY_STARTED" || code === "PARTY_LOCKED")) {
        setSeatsGone(true);
        setError(t("lobby.lastSeatAudience"));
      } else if (code === "PARTY_REMOVED") {
        setError(t("lobby.partyRemoved"));
      } else if (code === "SEATS_OPEN") {
        // A seat opened up meanwhile: take it instead.
        setSeatsGone(false);
        setInvite((current) => (current ? { ...current, seatsTaken: current.maxPlayers - 1, status: "lobby" } : current));
        setError(t("lobby.seatOpened"));
      } else if (code === "ROOM_FULL" || code === "ALREADY_STARTED" || code === "ROOM_NOT_FOUND") {
        setLoadError(code);
      } else {
        setError(audience ? t("lobby.audienceError") : t("lobby.seatError"));
      }
      setPending(false);
    }
  }

  if (loadError) return <RoomNotice code={loadError} />;
  if (!invite) return <TableLoading label={t("lobby.opening")} />;
  if (!audience && invite.status !== "lobby") return <RoomNotice code="ALREADY_STARTED" />;
  if (!audience && invite.seatsTaken >= invite.maxPlayers) return <RoomNotice code="ROOM_FULL" />;

  const gameName = invite.gameType === "ludo" ? t("entrance.ludo") : t("entrance.snakes");
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
            <span className="eyebrow">
              {t("lobby.partyEyebrow").toUpperCase()} · {gameName.toUpperCase()}
            </span>
            <h1>
              {t("lobby.audienceTitle1")}
              <br />
              <em>{t("lobby.audienceTitleEm")}</em>
            </h1>
            <p className="join-table-host">
              {t("lobby.audienceBody", {
                state: invite.partyLocked
                  ? t("lobby.audienceStateLocked")
                  : invite.status === "lobby"
                    ? t("lobby.audienceStateFull")
                    : t("lobby.audienceStateStarted"),
              })}
            </p>
          </>
        ) : (
          <>
            <span className="eyebrow">{t("lobby.invitedEyebrow").toUpperCase()}</span>
            <h1>
              {t("lobby.inviteTitle1")}
              <br />
              {t("lobby.inviteTitleLead")} <em>{t("lobby.inviteTitleEm")}</em>
            </h1>
            <p className="join-table-host">
              {t("lobby.inviteHost", {
                host: invite.hostName ?? t("lobby.aFriend"),
                count: invite.maxPlayers,
                game: gameName,
                seated: invite.seatsTaken,
                max: invite.maxPlayers,
              })}
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
            {t("entrance.yourName")}
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={24}
              placeholder={t("entrance.yourNamePlaceholder")}
              autoComplete="nickname"
            />
          </label>
          <button className="sim-primary" disabled={pending}>
            <span>
              {audience
                ? pending
                  ? t("lobby.joining")
                  : t("lobby.joinAudience")
                : pending
                  ? t("lobby.takingSeat")
                  : t("lobby.joinTable")}
            </span>
            <Icon name="arrow" />
          </button>
          {error && (
            <p className="lobby-error" role="alert">
              {error}
            </p>
          )}
        </form>
        <p className="join-table-note">{t("lobby.joinNote")}</p>
      </section>
    </main>
  );
}
