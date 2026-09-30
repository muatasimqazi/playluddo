"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getMyWins } from "@/lib/supabase/leaderboard";
import { Icon } from "@/components/simulator/Icon";
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
import { BRAND } from "@/lib/brand";
import { isNativeApp, webUrl } from "@/lib/native";
import { gameCenterAvailable, signInWithGameCenter } from "@/lib/gameCenter";
import {
  appleAuthorizationCode,
  nativeAppleSignInAvailable,
  nativeGoogleSignInAvailable,
  signInWithAppleNative,
  signInWithGoogleNative,
} from "@/lib/nativeAuth";
import { deleteAccount } from "@/lib/supabase/account";
import { useI18n, type Translator } from "@/lib/i18n";

type LoginMethod = "email" | "phone";

const AVATAR_PHOTO_SIZE = 512;
const AVATAR_STYLES: PhotoAvatarStyle[] = ["natural", "warm", "cool", "mono"];
const STYLE_KEYS = {
  natural: "account.styleNatural",
  warm: "account.styleWarm",
  cool: "account.styleCool",
  mono: "account.styleMono",
} as const satisfies Record<PhotoAvatarStyle, string>;

/** Center-cropped to a square and downsized, matching how every avatar
 * chip already renders with object-fit: cover — the upload never needs
 * its own cropper UI.
 *
 * Decodes via an <img> + decode(), not createImageBitmap(): the latter
 * has real gaps on real-world uploads (HEIC photos straight off an
 * iPhone camera roll in particular) that the ordinary image pipeline —
 * the same one every <img> on the page already relies on — handles fine.
 */
async function squareWebpFromFile(file: File, t: Translator): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(t("account.photoProcessError"));
    }
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_PHOTO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("account.imageProcessError"));
    ctx.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
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
    if (!blob) throw new Error(t("account.imageProcessError"));
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(" ");

function countryOptions(locale: string) {
  // Intl.DisplayNames is Chrome 81+/Safari 14+: guard it so older browsers
  // (e.g. LG webOS TVs on Chromium 79) fall back to the bare region code
  // instead of throwing "Intl.DisplayNames is not a constructor" at render.
  let names: Intl.DisplayNames | null = null;
  try {
    if (typeof Intl !== "undefined" && "DisplayNames" in Intl) {
      names = new Intl.DisplayNames([locale], { type: "region" });
    }
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}

/** Apple's logo for the Sign in with Apple button (Apple's HIG allows it there). */
function AppleLogo() {
  return (
    <svg className="profile-apple-logo" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </svg>
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

function profileName(user: User | null, t: Translator) {
  if (!user) return "";
  return (
    user.user_metadata?.display_name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    // A Game Center account's email is a private placeholder, not a name.
    (!user.app_metadata?.game_center && user.email?.split("@")[0]) ||
    user.phone ||
    t("common.player")
  );
}

export function ProfilePanel({
  onNameChange,
  onTeamsChange,
  onAvatarChange,
}: {
  onNameChange: (name: string) => void;
  onTeamsChange?: (teams: Team[]) => void;
  /** The signed-in profile's saved avatar id, or null when signed out/anonymous. */
  onAvatarChange?: (avatarId: string | null) => void;
}) {
  const { t, locale, dir } = useI18n();
  const client = useMemo(() => createClient(), []);
  const countries = useMemo(() => countryOptions(locale), [locale]);
  const avatarRail = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // Only affects the sign-in dialog, which never renders on the server.
  const native = isNativeApp();
  const gameCenter = native && gameCenterAvailable();
  // Website: Apple's redirect flow. iOS app: Apple's native sheet. Not yet
  // in the Android app (it would need the web flow's redirect back into
  // the app).
  const apple = !native || nativeAppleSignInAvailable();
  // Website: Google's redirect flow. iOS app: Google's native sheet.
  const google = !native || nativeGoogleSignInAvailable();
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
  const [wins, setWins] = useState<number | null>(null);
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [sharedTeamId, setSharedTeamId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [profileHidden, setProfileHidden] = useState(false);

  useEffect(() => {
    const applyUser = (nextUser: User | null) => {
      setUser(nextUser);
      const nextName = profileName(nextUser, t);
      setDisplayName(nextName);
      setAvatarId(nextUser?.user_metadata?.avatar_id ?? "");
      setCountry(nextUser?.user_metadata?.country ?? "");
      setProfileHidden(nextUser?.user_metadata?.profile_hidden === true);
      if (nextUser && !nextUser.is_anonymous && nextName) onNameChange(nextName);
      onAvatarChange?.(
        nextUser && !nextUser.is_anonymous ? nextUser.user_metadata?.avatar_id || null : null,
      );
    };

    void client.auth.getUser().then(({ data }) => applyUser(data.user));
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      applyUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [client, onNameChange, onAvatarChange, t]);

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
    // Fires on sign-in too, not just `open` — the home page surfaces a
    // team's active table (onTeamsChange below) without requiring the
    // profile panel to have been opened first this session. Still also
    // fires on open, so reopening the panel refreshes a stale activeRoom
    // (e.g. a teammate started a table after this client's initial load).
    if (!user || user.is_anonymous) return;
    void getMyTeams(client)
      .then(setTeams)
      .catch(() =>
        setMessage(t("account.couldNotLoadTeams")),
      );
    void getMyWins(client).then(setWins).catch(() => setWins(null));
  }, [client, user, open, t]);

  useEffect(() => {
    onTeamsChange?.(teams);
  }, [teams, onTeamsChange]);

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
  const identity = user?.app_metadata?.game_center
    ? t("account.signedInGameCenter")
    : user?.email || user?.phone || t("account.signedInPlayer");

  async function signInWithGoogle() {
    setPending("google");
    setMessage(null);
    if (native) {
      const result = await signInWithGoogleNative(client);
      setPending(null);
      if (result.status === "failed") setMessage(t("common.connectError"));
      if (result.status === "signed-in") setOpen(false);
      return;
    }
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: webUrl("/") },
    });
    if (error) {
      setMessage(t("common.connectError"));
      setPending(null);
    }
  }

  async function continueWithApple() {
    setPending("apple");
    setMessage(null);
    if (!native) {
      const { error } = await client.auth.signInWithOAuth({
        provider: "apple",
        options: { redirectTo: webUrl("/") },
      });
      if (error) {
        setMessage(t("common.connectError"));
        setPending(null);
      }
      return;
    }
    const result = await signInWithAppleNative(client);
    setPending(null);
    if (result.status === "failed") setMessage(t("common.connectError"));
    if (result.status === "signed-in") setOpen(false);
  }

  async function continueWithGameCenter() {
    setPending("game-center");
    setMessage(null);
    const problem = await signInWithGameCenter(client);
    setPending(null);
    if (problem) {
      setMessage(t("common.connectError"));
      return;
    }
    setOpen(false);
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
              emailRedirectTo: webUrl("/"),
            },
          }
        : { phone: value, options: { shouldCreateUser: true } },
    );
    setPending(null);
    if (error) {
      setMessage(t("account.authError"));
      return;
    }
    setSent(true);
    setMessage(
      method === "email"
        ? t("account.checkEmail")
        : t("account.enterPhoneCode"),
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
      setMessage(t("account.codeError"));
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
      setMessage(t("account.chooseImageFile"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage(t("account.imageTooLarge"));
      return;
    }
    setUploadingPhoto(true);
    setMessage(null);
    try {
      const blob = await squareWebpFromFile(file, t);
      const path = `${user.id}/avatar.webp`;
      const { error: uploadError } = await client.storage
        .from("avatar-photos")
        .upload(path, blob, { upsert: true, contentType: "image/webp" });
      if (uploadError) throw uploadError;
      const { data } = client.storage.from("avatar-photos").getPublicUrl(path);
      // Cache-bust: the path is stable per user (upsert), so a re-upload
      // would otherwise keep showing whatever was cached under that URL.
      setAvatarId(makePhotoAvatar(`${data.publicUrl}?v=${Date.now()}`, "natural"));
    } catch {
      setMessage(t("account.couldNotUploadPhoto"));
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
      setMessage(t("account.profileSaveError"));
      return;
    }
    setUser(data.user);
    onNameChange(name);
    onAvatarChange?.(avatarId);
    setMessage(t("account.profileSaved"));
  }

  // The profile page's stats show to other players from your seat's avatar
  // (F3.1). This hides them from everyone but you; your name and avatar stay
  // visible, since they already show at the table.
  async function toggleProfileHidden() {
    const next = !profileHidden;
    setProfileHidden(next);
    setPending("privacy");
    setMessage(null);
    const { data, error } = await client.auth.updateUser({ data: { profile_hidden: next } });
    setPending(null);
    if (error) {
      setProfileHidden(!next);
      setMessage(t("account.privacyError"));
      return;
    }
    setUser(data.user);
  }

  async function signOut() {
    setPending("signout");
    const { error } = await client.auth.signOut();
    setPending(null);
    if (error) {
      setMessage(t("account.signOutError"));
      return;
    }
    setUser(null);
    setMessage(null);
  }

  // Apple requires revoking Sign in with Apple on deletion; in the iOS app
  // the player confirms with Apple once more to get a code for that.
  const confirmWithApple =
    native &&
    nativeAppleSignInAvailable() &&
    !!user?.identities?.some((identity) => identity.provider === "apple");

  async function removeAccount() {
    setPending("delete");
    setMessage(null);
    let appleCode: string | undefined;
    if (confirmWithApple) {
      const apple = await appleAuthorizationCode();
      if (apple.status === "cancelled") {
        setPending(null);
        return;
      }
      // If Apple can't be reached, still delete: the player's request for
      // their data to be gone mustn't depend on it.
      if (apple.status === "ok") appleCode = apple.code;
    }
    const problem = await deleteAccount(client, { appleAuthorizationCode: appleCode });
    setPending(null);
    if (problem) {
      setMessage(t("account.deleteError"));
      return;
    }
    setConfirmingDelete(false);
    setUser(null);
    setTeams([]);
    setWins(null);
    setMessage(t("account.accountDeleted"));
  }

  async function makeTeam() {
    const value = teamName.trim();
    if (!value) return;
    setPending("create-team");
    setMessage(null);
    try {
      setTeams(await createTeam(client, value, displayName, avatarId));
      setTeamName("");
      setMessage(t("account.teamCreated"));
    } catch {
      setMessage(t("account.couldNotCreateTeam"));
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
      setMessage(t("account.joinedTeam"));
    } catch {
      setMessage(t("account.couldNotJoinTeam"));
    } finally {
      setPending(null);
    }
  }

  async function removeTeam(team: Team) {
    setPending(`leave-team:${team.id}`);
    setMessage(null);
    try {
      setTeams(await leaveTeam(client, team.id));
      setMessage(team.ownerUserId === user?.id ? t("account.teamDeleted") : t("account.leftTeam"));
    } catch {
      setMessage(t("account.couldNotUpdateTeam"));
    } finally {
      setPending(null);
    }
  }

  async function shareTeam(team: Team) {
    const url = webUrl(`/?team=${team.inviteCode}`);
    try {
      if (navigator.share) {
        await navigator.share({
          title: t("account.shareTeamTitle", { team: team.name, brand: BRAND.name }),
          text: t("account.shareTeamText", { game: BRAND.gameName, team: team.name, brand: BRAND.name }),
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setSharedTeamId(team.id);
      window.setTimeout(() => setSharedTeamId(null), 1800);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(t("account.couldNotShareInvite"));
    }
  }

  return (
    <>
      <button
        className="profile-trigger"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={authenticated ? t("account.openProfile") : t("account.signInCreate")}
      >
        {authenticated ? (
          <AnimatedAvatar
            id={user.user_metadata?.avatar_id}
            fallback={profileName(user, t).slice(0, 1).toUpperCase()}
          />
        ) : (
          <span className="profile-guest-avatar">○</span>
        )}
        {authenticated ? profileName(user, t) : t("account.signIn")}
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
              aria-label={t("account.closeProfile")}
            >
              ×
            </button>
            <span className="eyebrow">{t("account.eyebrowSeat").toUpperCase()}</span>
            <h2 id="profile-heading">{authenticated ? t("account.yourProfile") : t("account.welcomeBack")}</h2>
            {authenticated ? (
              <>
                <div className="profile-identity">
                  {avatarDefinition(avatarId) || photoAvatar(avatarId) ? (
                    <AnimatedAvatar id={avatarId} />
                  ) : user.user_metadata?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- provider avatars are remote and domains vary.
                    <img src={user.user_metadata.avatar_url} alt="" />
                  ) : (
                    <span>{profileName(user, t).slice(0, 1).toUpperCase()}</span>
                  )}
                  <div>
                    <strong>{profileName(user, t)}</strong>
                    <small>{identity}</small>
                  </div>
                </div>
                <Link
                  className="profile-secondary"
                  href="/profile"
                  onClick={() => setOpen(false)}
                >
                  <Icon name="users" />
                  {t("account.yourProfileStats")}
                </Link>
                <Link
                  className="profile-secondary"
                  href="/leaderboard"
                  onClick={() => setOpen(false)}
                >
                  <Icon name="trophy" />
                  {wins === null
                    ? t("common.leaderboard")
                    : t("account.winsAndLeaderboard", {
                        wins: t(wins === 1 ? "leaderboard.winOne" : "leaderboard.winOther", { count: wins }),
                      })}
                </Link>
                <label className="profile-privacy">
                  <input
                    type="checkbox"
                    checked={profileHidden}
                    disabled={pending !== null}
                    onChange={() => void toggleProfileHidden()}
                  />
                  <span>
                    <strong>{t("account.hideStats")}</strong>
                    <small>{t("account.hideStatsNote")}</small>
                  </span>
                </label>
                <label className="profile-field">
                  {t("account.displayName")}
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={24}
                    autoComplete="nickname"
                  />
                </label>
                <div className="profile-avatar-field">
                  <div className="profile-avatar-heading">
                    <span>{t("entrance.chooseAvatar")}</span>
                    <div className="profile-avatar-controls" aria-label={t("account.scrollAvatars")}>
                      <button
                        type="button"
                        aria-label={t("account.prevAvatars")}
                        onClick={() => avatarRail.current?.scrollBy({ left: dir === "rtl" ? 190 : -190, behavior: "smooth" })}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        aria-label={t("account.nextAvatars")}
                        onClick={() => avatarRail.current?.scrollBy({ left: dir === "rtl" ? -190 : 190, behavior: "smooth" })}
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
                          ? t("account.changePhoto")
                          : t("account.uploadPhoto")
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
                    <div className="profile-style-picker" role="radiogroup" aria-label={t("account.photoStyle")}>
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
                          {t(STYLE_KEYS[style])}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <label className="profile-field">
                  {t("account.country")}
                  <select value={country} onChange={(event) => setCountry(event.target.value)}>
                    <option value="">{t("account.selectCountry")}</option>
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
                  {pending === "profile" ? t("actions.saving") : t("account.save")}
                </button>
                <section className="profile-teams" aria-labelledby="teams-heading">
                  <div className="profile-team-heading">
                    <div>
                      <span className="eyebrow">{t("account.privateGroups").toUpperCase()}</span>
                      <h3 id="teams-heading">{t("account.yourTeams")}</h3>
                    </div>
                    <small>{teams.length}</small>
                  </div>
                  <div className="profile-team-create">
                    <input
                      value={teamName}
                      onChange={(event) => setTeamName(event.target.value)}
                      placeholder={t("account.newTeamName")}
                      maxLength={32}
                      aria-label={t("account.newTeamName")}
                    />
                    <button
                      type="button"
                      disabled={pending !== null || teamName.trim().length < 2}
                      onClick={() => void makeTeam()}
                    >
                      {pending === "create-team" ? t("account.creating") : t("account.create")}
                    </button>
                  </div>
                  <div className="profile-team-create">
                    <input
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                      placeholder={t("account.friendTeamCode")}
                      maxLength={10}
                      aria-label={t("account.teamInviteCode")}
                      dir="ltr"
                    />
                    <button
                      type="button"
                      disabled={pending !== null || !inviteCode.trim()}
                      onClick={() => void acceptTeamInvite()}
                    >
                      {pending === "join-team" ? t("lobby.joining") : t("actions.join")}
                    </button>
                  </div>
                  <div className="profile-team-list">
                    {teams.map((team) => (
                      <article key={team.id} className="profile-team-card">
                        <div className="profile-team-title">
                          <div>
                            <strong>{team.name}</strong>
                            <small>
                              {t(team.members.length === 1 ? "entrance.memberOne" : "entrance.memberOther", {
                                count: team.members.length,
                              })}
                            </small>
                          </div>
                          <code dir="ltr">{team.inviteCode}</code>
                        </div>
                        <div className="profile-team-members" aria-label={t("account.teamMembersAria", { team: team.name })}>
                          {team.members.map((member) => (
                            <span key={member.userId} title={`${member.displayName}${member.role === "owner" ? ` · ${t("account.owner")}` : ""}`}>
                              <AnimatedAvatar id={member.avatarId ?? undefined} fallback={member.displayName.slice(0, 1)} />
                            </span>
                          ))}
                        </div>
                        <div className="profile-team-actions">
                          <button type="button" onClick={() => void shareTeam(team)}>
                            {sharedTeamId === team.id ? t("account.shared") : t("account.shareInvite")}
                          </button>
                          <button
                            type="button"
                            disabled={pending !== null}
                            onClick={() => void removeTeam(team)}
                          >
                            {team.ownerUserId === user.id ? t("account.delete") : t("account.leave")}
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
                  {t("account.signOut")}
                </button>
                {/* Draft account-deletion copy requires native and legal review. */}
                {confirmingDelete ? (
                  <div className="profile-delete" role="group" aria-labelledby="delete-heading">
                    <strong id="delete-heading">{t("account.deleteAccountQ")}</strong>
                    <p>
                      {t("account.deleteBody")}
                      {confirmWithApple && t("account.deleteAppleNote")}
                    </p>
                    <div className="profile-delete-actions">
                      <button
                        type="button"
                        disabled={pending !== null}
                        onClick={() => setConfirmingDelete(false)}
                      >
                        {t("actions.cancel")}
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        disabled={pending !== null}
                        onClick={() => void removeAccount()}
                      >
                        {pending === "delete" ? t("account.deleting") : t("account.deleteMine")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="profile-delete-link"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => setConfirmingDelete(true)}
                  >
                    {t("account.deleteAccount")}
                  </button>
                )}
              </>
            ) : (
              <>
                <p>{t("account.guestPrompt")}</p>
                {/* In the apps Apple and Google use their native sheets (Google
                    blocks its web sign-in inside embedded web views). Apple
                    comes first — App Store guideline 4.8 wants it offered
                    alongside any other social sign-in. Email/phone codes work
                    everywhere. */}
                {(apple || google || gameCenter) && (
                  <>
                    <div className="profile-socials">
                      {apple && (
                        <button
                          type="button"
                          className="profile-apple"
                          disabled={pending !== null}
                          onClick={() => void continueWithApple()}
                        >
                          <AppleLogo />
                          {pending === "apple" ? t("account.signingIn") : t("account.continueApple")}
                        </button>
                      )}
                      {google && (
                        <button type="button" disabled={pending !== null} onClick={() => void signInWithGoogle()}>
                          <b>G</b>
                          {pending === "google" && native ? t("account.signingIn") : t("account.continueGoogle")}
                        </button>
                      )}
                      {gameCenter && (
                        <button
                          type="button"
                          disabled={pending !== null}
                          onClick={() => void continueWithGameCenter()}
                        >
                          <Icon name="trophy" size={16} />
                          {pending === "game-center" ? t("account.signingIn") : t("account.continueGameCenter")}
                        </button>
                      )}
                    </div>
                    <span className="profile-divider">{t("account.orUseCode")}</span>
                  </>
                )}
                <div className="profile-methods" role="tablist" aria-label={t("account.signInMethod")}>
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
                      {value === "email" ? t("account.email") : t("account.phone")}
                    </button>
                  ))}
                </div>
                <label className="profile-field">
                  {method === "email" ? t("account.emailAddress") : t("account.phoneNumber")}
                  <input
                    type={method === "email" ? "email" : "tel"}
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    placeholder={method === "email" ? t("account.emailExample") : t("account.phoneExample")}
                    dir="ltr"
                    autoComplete={method === "email" ? "email" : "tel"}
                  />
                </label>
                {sent && (
                  <label className="profile-field">
                    {t("account.verificationCode")}
                    <input
                      inputMode="numeric"
                      value={token}
                      onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder={t("account.codeExample")}
                      dir="ltr"
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
                    ? t("account.pleaseWait")
                    : sent
                      ? t("account.verifySignIn")
                      : method === "email"
                        ? t("account.sendEmailCode")
                        : t("account.sendTextCode")}
                </button>
                <small className="profile-guest-note">{t("account.guestNote")}</small>
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
