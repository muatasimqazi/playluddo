"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { AVATARS, avatarDefinition } from "@/lib/avatars/catalog";

type LoginMethod = "email" | "phone";

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(" ");

function countryOptions() {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function AnimatedAvatar({ id, fallback = "P" }: { id?: string; fallback?: string }) {
  const avatar = avatarDefinition(id);
  return (
    <span className="animated-avatar" data-avatar={id || "player"} aria-hidden="true">
      <span className="avatar-glow" />
      {avatar ? (
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
  const [message, setMessage] = useState<string | null>(null);

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
