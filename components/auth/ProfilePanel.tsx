"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  AVATARS,
  avatarDefinition,
  makePhotoAvatar,
  photoAvatar,
  type PhotoAvatarStyle,
} from "@/lib/avatars/catalog";
import {
  createTeam,
  getMyTeams,
  joinTeam,
  leaveTeam,
  type Team,
} from "@/lib/supabase/teams";

type LoginMethod = "email" | "phone";

const AVATAR_PHOTO_SIZE = 512;
const AVATAR_STYLES: PhotoAvatarStyle[] = ["natural", "warm", "cool", "mono"];

/** Center-cropped to a square and downsized, matching how every avatar
 * chip already renders with object-fit: cover — the upload never needs
 * its own cropper UI. */
async function squareWebpFromFile(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_PHOTO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process that image.");
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PHOTO_SIZE,
      AVATAR_PHOTO_SIZE,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    if (!blob) throw new Error("Could not process that image.");
    return blob;
  } finally {
    bitmap.close();
  }
}

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(" ");

function countryOptions() {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function AnimatedAvatar({ id, fallback = "P" }: { id?: string; fallback?: string }) {
  const avatar = avatarDefinition(id);
  const photo = photoAvatar(id);
  return (
    <span
      className="animated-avatar"
      data-avatar={avatar?.id || "player"}
      aria-hidden="true"
    >
      <span className="avatar-glow" />
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded avatar photos are user Storage URLs, not app-optimizable static assets.
        <img
          className="avatar-portrait is-photo-avatar"
          data-photo-style={photo.style}
          src={photo.portrait}
          alt=""
        />
      ) : avatar ? (
        // eslint-disable-next-line @next/next/no-img-element -- local avatar thumbnails are tiny pre-optimized WebP assets.
        <img className="avatar-portrait" src={avatar.portrait} alt="" />
      ) : (
        <span className="avatar-fallback">{fallback}</span>
      )}
      <span className="avatar-spark">✦</span>
    </span>
  );
}

function profileName(user: User | null) {
  if (!user) return "";
  return (
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    user.phone ||
    "Player"
  );
}

export function ProfilePanel({
  onNameChange,
}: {
  onNameChange: (name: string) => void;
}) {
  const client = useMemo(() => createClient(), []);
  const countries = useMemo(() => countryOptions(), []);
  const avatarRail = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [method, setMethod] = useState<LoginMethod>("email");
  const [destination, setDestination] = useState("");
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatarId, setAvatarId] = useState("");
  const [country, setCountry] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [sharedTeamId, setSharedTeamId] = useState<string | null>(null);

  useEffect(() => {
    const applyUser = (nextUser: User | null) => {
      setUser(nextUser);
      const nextName = profileName(nextUser);
      setDisplayName(nextName);
      setAvatarId(nextUser?.user_metadata?.avatar_id ?? "");
      setCountry(nextUser?.user_metadata?.country ?? "");
      if (nextUser && !nextUser.is_anonymous && nextName) onNameChange(nextName);
    };

    void client.auth.getUser().then(({ data }) => applyUser(data.user));
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [client, onNameChange]);

  useEffect(() => {
    const invited = new URLSearchParams(window.location.search).get("team");
    if (!invited) return;
    const frame = requestAnimationFrame(() => {
      setInviteCode(invited.toUpperCase());
      setOpen(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open || !user || user.is_anonymous) return;
    void getMyTeams(client)
      .then(setTeams)
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "Could not load teams."),
      );
  }, [client, open, user]);

  useEffect(() => {
    if (!open || !avatarId) return;
    const frame = requestAnimationFrame(() => {
      avatarRail.current
        ?.querySelector<HTMLElement>(`[data-avatar-choice="${avatarId}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, avatarId]);

  const authenticated = !!user && !user.is_anonymous;
  const identity = user?.email || user?.phone || "Signed-in player";

  async function signInWithGoogle() {
    setPending("google");
    setMessage(null);
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setMessage(error.message);
      setPending(null);
    }
  }

  async function sendCode() {
    const value = destination.trim();
    if (!value) return;
    setPending("send");
    setMessage(null);
    const { error } = await client.auth.signInWithOtp(
      method === "email"
        ? {
            email: value,
            options: {
              shouldCreateUser: true,
              emailRedirectTo: window.location.origin,
            },
          }
        : { phone: value, options: { shouldCreateUser: true } },
    );
    setPending(null);
    if (error) {
      setMessage(error.message);
      return;
    }
    setSent(true);
    setMessage(
      method === "email"
        ? "Check your email for a sign-in link or verification code."
        : "Enter the verification code sent to your phone.",
    );
  }

  async function verifyCode() {
    setPending("verify");
    setMessage(null);
    const value = destination.trim();
    const { data, error } = await client.auth.verifyOtp(
      method === "email"
        ? { email: value, token: token.trim(), type: "email" }
        : { phone: value, token: token.trim(), type: "sms" },
    );
    setPending(null);
    if (error) {
      setMessage(error.message);
      return;
    }
    setUser(data.user);
    setSent(false);
    setToken("");
    setMessage(null);
    setOpen(false);
  }

  async function uploadPhoto(file: File) {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose an image file for your avatar.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage("That image is too large — try one under 8MB.");
      return;
    }
    setUploadingPhoto(true);
    setMessage(null);
    try {
      const blob = await squareWebpFromFile(file);
      const path = `${user.id}/avatar.webp`;
      const { error: uploadError } = await client.storage
        .from("avatar-photos")
        .upload(path, blob, { upsert: true, contentType: "image/webp" });
      if (uploadError) throw uploadError;
      const { data } = client.storage.from("avatar-photos").getPublicUrl(path);
      // Cache-bust: the path is stable per user (upsert), so a re-upload
      // would otherwise keep showing whatever was cached under that URL.
      setAvatarId(makePhotoAvatar(`${data.publicUrl}?v=${Date.now()}`, "natural"));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not upload that photo.",
      );
    } finally {
      setUploadingPhoto(false);
    }
  }

  function setPhotoStyle(style: PhotoAvatarStyle) {
    const photo = photoAvatar(avatarId);
    if (!photo) return;
    setAvatarId(makePhotoAvatar(photo.portrait, style));
  }

  async function saveProfile() {
    const name = displayName.trim();
    if (!name || !avatarId) return;
    setPending("profile");
    setMessage(null);
    const { data, error } = await client.auth.updateUser({
      data: { display_name: name, avatar_id: avatarId, country },
    });
    setPending(null);
    if (error) {
      setMessage(error.message);
      return;
    }
    setUser(data.user);
    onNameChange(name);
    setMessage("Profile saved.");
  }

  async function signOut() {
    setPending("signout");
    const { error } = await client.auth.signOut();
    setPending(null);
    if (error) {
      setMessage(error.message);
      return;
    }
    setUser(null);
    setMessage(null);
  }

  async function makeTeam() {
    const value = teamName.trim();
    if (!value) return;
    setPending("create-team");
    setMessage(null);
    try {
      setTeams(await createTeam(client, value, displayName, avatarId));
      setTeamName("");
      setMessage("Private team created. Share its invite with your friends.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the team.");
    } finally {
      setPending(null);
    }
  }

  async function acceptTeamInvite() {
    const value = inviteCode.trim();
    if (!value) return;
    setPending("join-team");
    setMessage(null);
    try {
      setTeams(await joinTeam(client, value, displayName, avatarId));
      setInviteCode("");
      const url = new URL(window.location.href);
      url.searchParams.delete("team");
      window.history.replaceState({}, "", url);
      setMessage("You joined the team.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join the team.");
    } finally {
      setPending(null);
    }
  }

  async function removeTeam(team: Team) {
    setPending(`leave-team:${team.id}`);
    setMessage(null);
    try {
      setTeams(await leaveTeam(client, team.id));
      setMessage(team.ownerUserId === user?.id ? "Team deleted." : "You left the team.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the team.");
    } finally {
      setPending(null);
    }
  }

  async function shareTeam(team: Team) {
    const url = `${window.location.origin}/?team=${team.inviteCode}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Join ${team.name} on Luddo`,
          text: `Join my private Luddo team, ${team.name}.`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setSharedTeamId(team.id);
      window.setTimeout(() => setSharedTeamId(null), 1800);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("Could not share the invite. Copy the team code instead.");
    }
  }

  return (
    <>
      <button
        className="profile-trigger"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={authenticated ? "Open your profile" : "Sign in or create a profile"}
      >
        {authenticated ? (
          <AnimatedAvatar
            id={user.user_metadata?.avatar_id}
            fallback={profileName(user).slice(0, 1).toUpperCase()}
          />
        ) : (
          <span className="profile-guest-avatar">○</span>
        )}
        {authenticated ? profileName(user) : "Sign in"}
      </button>
      {open && createPortal(
        <div className="profile-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="profile-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-heading"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="profile-close"
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close profile"
            >
              ×
            </button>
            <span className="eyebrow">YOUR SEAT AT THE TABLE</span>
            <h2 id="profile-heading">{authenticated ? "Your profile" : "Welcome back"}</h2>
            {authenticated ? (
              <>
                <div className="profile-identity">
                  {avatarDefinition(avatarId) ? (
                    <AnimatedAvatar id={avatarId} />
                  ) : user.user_metadata?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- provider avatars are remote and domains vary.
                    <img src={user.user_metadata.avatar_url} alt="" />
                  ) : (
                    <span>{profileName(user).slice(0, 1).toUpperCase()}</span>
                  )}
                  <div>
                    <strong>{profileName(user)}</strong>
                    <small>{identity}</small>
                  </div>
                </div>
                <label className="profile-field">
                  Display name
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={24}
                    autoComplete="nickname"
                  />
                </label>
                <div className="profile-avatar-field">
                  <div className="profile-avatar-heading">
                    <span>Choose your avatar</span>
                    <div className="profile-avatar-controls" aria-label="Scroll avatars">
                      <button
                        type="button"
                        aria-label="Previous avatars"
                        onClick={() => avatarRail.current?.scrollBy({ left: -190, behavior: "smooth" })}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        aria-label="Next avatars"
                        onClick={() => avatarRail.current?.scrollBy({ left: 190, behavior: "smooth" })}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                  <div ref={avatarRail} className="profile-avatars">
                    <button
                      type="button"
                      className={`profile-avatar-upload ${photoAvatar(avatarId) ? "is-selected" : ""}`}
                      aria-label={
                        photoAvatar(avatarId)
                          ? "Change your photo"
                          : "Upload your own photo"
                      }
                      aria-pressed={!!photoAvatar(avatarId)}
                      disabled={uploadingPhoto}
                      onClick={() => photoInput.current?.click()}
                    >
                      {photoAvatar(avatarId) ? (
                        <AnimatedAvatar id={avatarId} />
                      ) : (
                        <span className="profile-avatar-upload-icon" aria-hidden="true">
                          {uploadingPhoto ? "…" : "+"}
                        </span>
                      )}
                    </button>
                    <input
                      ref={photoInput}
                      type="file"
                      accept="image/*"
                      className="profile-avatar-upload-input"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadPhoto(file);
                      }}
                    />
                    {AVATARS.map((avatar) => (
                      <button
                        key={avatar.id}
                        data-avatar-choice={avatar.id}
                        type="button"
                        className={avatarId === avatar.id ? "is-selected" : ""}
                        aria-label={avatar.label}
                        aria-pressed={avatarId === avatar.id}
                        onClick={() => setAvatarId(avatar.id)}
                      >
                        <AnimatedAvatar id={avatar.id} />
                      </button>
                    ))}
                  </div>
                  {photoAvatar(avatarId) && (
                    <div className="profile-style-picker" role="radiogroup" aria-label="Photo style">
                      {AVATAR_STYLES.map((style) => (
                        <button
                          key={style}
                          type="button"
                          data-photo-style={style}
                          className={
                            photoAvatar(avatarId)?.style === style ? "is-selected" : ""
                          }
                          aria-pressed={photoAvatar(avatarId)?.style === style}
                          onClick={() => setPhotoStyle(style)}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <label className="profile-field">
                  Country
                  <select value={country} onChange={(event) => setCountry(event.target.value)}>
                    <option value="">Select your country</option>
                    {countries.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="profile-primary"
                  type="button"
                  disabled={pending !== null || !displayName.trim() || !avatarId}
                  onClick={() => void saveProfile()}
                >
                  {pending === "profile" ? "Saving…" : "Save profile"}
                </button>
                <section className="profile-teams" aria-labelledby="teams-heading">
                  <div className="profile-team-heading">
                    <div>
                      <span className="eyebrow">PRIVATE GROUPS</span>
                      <h3 id="teams-heading">Your teams</h3>
                    </div>
                    <small>{teams.length}</small>
                  </div>
                  <div className="profile-team-create">
                    <input
                      value={teamName}
                      onChange={(event) => setTeamName(event.target.value)}
                      placeholder="New team name"
                      maxLength={32}
                      aria-label="New team name"
                    />
                    <button
                      type="button"
                      disabled={pending !== null || teamName.trim().length < 2}
                      onClick={() => void makeTeam()}
                    >
                      {pending === "create-team" ? "Creating…" : "Create"}
                    </button>
                  </div>
                  <div className="profile-team-create">
                    <input
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                      placeholder="Friend’s team code"
                      maxLength={10}
                      aria-label="Team invite code"
                    />
                    <button
                      type="button"
                      disabled={pending !== null || !inviteCode.trim()}
                      onClick={() => void acceptTeamInvite()}
                    >
                      {pending === "join-team" ? "Joining…" : "Join"}
                    </button>
                  </div>
                  <div className="profile-team-list">
                    {teams.map((team) => (
                      <article key={team.id} className="profile-team-card">
                        <div className="profile-team-title">
                          <div>
                            <strong>{team.name}</strong>
                            <small>{team.members.length} {team.members.length === 1 ? "member" : "members"}</small>
                          </div>
                          <code>{team.inviteCode}</code>
                        </div>
                        <div className="profile-team-members" aria-label={`${team.name} members`}>
                          {team.members.map((member) => (
                            <span key={member.userId} title={`${member.displayName}${member.role === "owner" ? " · Owner" : ""}`}>
                              <AnimatedAvatar id={member.avatarId ?? undefined} fallback={member.displayName.slice(0, 1)} />
                            </span>
                          ))}
                        </div>
                        <div className="profile-team-actions">
                          <button type="button" onClick={() => void shareTeam(team)}>
                            {sharedTeamId === team.id ? "Shared" : "Share invite"}
                          </button>
                          <button
                            type="button"
                            disabled={pending !== null}
                            onClick={() => void removeTeam(team)}
                          >
                            {team.ownerUserId === user.id ? "Delete" : "Leave"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
                <button
                  className="profile-secondary"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void signOut()}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <p>Save your name and return to the same identity on any device.</p>
                <div className="profile-socials">
                  <button type="button" disabled={pending !== null} onClick={() => void signInWithGoogle()}>
                    <b>G</b> Continue with Google
                  </button>
                </div>
                <span className="profile-divider">or use a code</span>
                <div className="profile-methods" role="tablist" aria-label="Sign-in method">
                  {(["email", "phone"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={method === value}
                      className={method === value ? "is-selected" : ""}
                      onClick={() => {
                        setMethod(value);
                        setDestination("");
                        setToken("");
                        setSent(false);
                        setMessage(null);
                      }}
                    >
                      {value === "email" ? "Email" : "Phone"}
                    </button>
                  ))}
                </div>
                <label className="profile-field">
                  {method === "email" ? "Email address" : "Phone number"}
                  <input
                    type={method === "email" ? "email" : "tel"}
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    placeholder={method === "email" ? "you@example.com" : "+1 555 123 4567"}
                    autoComplete={method === "email" ? "email" : "tel"}
                  />
                </label>
                {sent && (
                  <label className="profile-field">
                    Verification code
                    <input
                      inputMode="numeric"
                      value={token}
                      onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="123456"
                      autoComplete="one-time-code"
                    />
                  </label>
                )}
                <button
                  className="profile-primary"
                  type="button"
                  disabled={pending !== null || !destination.trim() || (sent && token.length < 6)}
                  onClick={() => void (sent ? verifyCode() : sendCode())}
                >
                  {pending
                    ? "Please wait…"
                    : sent
                      ? "Verify and sign in"
                      : `Send ${method === "email" ? "email" : "text"} code`}
                </button>
                <small className="profile-guest-note">You can keep playing as a guest without signing in.</small>
              </>
            )}
            {message && <p className="profile-message" role="status">{message}</p>}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
