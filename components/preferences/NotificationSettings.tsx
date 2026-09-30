"use client";

/**
 * The Notifications section of the profile panel (F1.7): turn push on or off
 * for this device, switch each kind on or off for the account, and set quiet
 * hours. Guests only see the kinds that can reach them (turn and rematch);
 * friend and team alerts need an account.
 */
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";
import {
  disablePushOnThisDevice,
  enablePush,
  getNotificationSettings,
  needsHomeScreenInstall,
  pushAvailability,
  pushOnHere,
  pushPermission,
  setNotificationSettings,
  type NotificationSettings as Settings,
  type PushPermission,
} from "@/lib/push";

type KindKey = "turn" | "rematch" | "friendTable" | "teamTable";

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const fromTime = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export function NotificationSettings({ signedIn }: { signedIn: boolean }) {
  const { t, locale } = useI18n();
  const [client] = useState(createClient);
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [onHere, setOnHere] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await pushPermission().catch(() => "unsupported" as const);
      if (cancelled) return;
      setPermission(current);
      setOnHere(await pushOnHere().catch(() => false));
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      const loaded = await getNotificationSettings(client).catch(() => null);
      if (!cancelled && loaded) setSettings(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function turnOn() {
    setPending(true);
    setMessage(null);
    try {
      await ensureSession(client);
      const result = await enablePush(client, locale, t("notifications.androidChannel"));
      setPermission(result);
      setOnHere(result === "granted");
      if (result === "granted" && !settings) setSettings(await getNotificationSettings(client));
    } catch {
      setMessage(t("notifications.couldNotEnable"));
    } finally {
      setPending(false);
    }
  }

  async function turnOff() {
    setPending(true);
    setMessage(null);
    try {
      await disablePushOnThisDevice(client);
      setOnHere(false);
    } catch {
      setMessage(t("notifications.couldNotSave"));
    } finally {
      setPending(false);
    }
  }

  async function save(patch: Partial<Settings>) {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setMessage(null);
    try {
      setSettings(await setNotificationSettings(client, patch));
    } catch {
      setSettings(previous);
      setMessage(t("notifications.couldNotSave"));
    }
  }

  const availability = pushAvailability();
  const kinds: { key: KindKey; label: string; hint?: string }[] = [
    { key: "turn", label: t("notifications.turn"), hint: t("notifications.turnHint") },
    { key: "rematch", label: t("notifications.rematch") },
    ...(signedIn
      ? [
          { key: "friendTable" as const, label: t("notifications.friendTable") },
          { key: "teamTable" as const, label: t("notifications.teamTable") },
        ]
      : []),
  ];

  return (
    <section className="profile-teams notification-settings" aria-labelledby="notifications-heading">
      <div className="profile-team-heading">
        <div>
          <h3 id="notifications-heading">{t("notifications.heading")}</h3>
        </div>
      </div>

      {availability === "unsupported" ? (
        <p className="notification-note">
          {needsHomeScreenInstall()
            ? t("notifications.installFirst", { brand: BRAND.name })
            : t("notifications.unsupported")}
        </p>
      ) : permission === "denied" ? (
        <p className="notification-note">{t("notifications.blocked", { brand: BRAND.name })}</p>
      ) : onHere ? (
        <button className="profile-secondary" type="button" disabled={pending} onClick={() => void turnOff()}>
          {t("notifications.turnOffHere")}
        </button>
      ) : (
        <button
          className="profile-secondary"
          type="button"
          disabled={pending || permission === null}
          onClick={() => void turnOn()}
        >
          {pending ? t("notifications.turningOn") : t("notifications.turnOn")}
        </button>
      )}

      {onHere && settings && (
        <div className="notification-kinds">
          <small className="notification-on-here">{t("notifications.onHere")}</small>
          {kinds.map(({ key, label, hint }) => (
            <label key={key} className="profile-privacy">
              <input type="checkbox" checked={settings[key]} onChange={() => void save({ [key]: !settings[key] })} />
              <span>
                <strong>{label}</strong>
                {hint && <small>{hint}</small>}
              </span>
            </label>
          ))}
          {!signedIn && <p className="notification-note">{t("notifications.signInForSocial")}</p>}

          {signedIn && (
            <>
              <label className="profile-privacy">
                <input
                  type="checkbox"
                  checked={settings.quietEnabled}
                  onChange={() => void save({ quietEnabled: !settings.quietEnabled })}
                />
                <span>
                  <strong>{t("notifications.quietHours")}</strong>
                  <small>{t("notifications.quietHint")}</small>
                </span>
              </label>
              {settings.quietEnabled && (
                <div className="notification-quiet">
                  <label>
                    {t("notifications.from")}
                    <input
                      type="time"
                      dir="ltr"
                      value={toTime(settings.quietStart)}
                      onChange={(event) => {
                        const minutes = fromTime(event.target.value);
                        if (minutes !== null) void save({ quietStart: minutes });
                      }}
                    />
                  </label>
                  <label>
                    {t("notifications.to")}
                    <input
                      type="time"
                      dir="ltr"
                      value={toTime(settings.quietEnd)}
                      onChange={(event) => {
                        const minutes = fromTime(event.target.value);
                        if (minutes !== null) void save({ quietEnd: minutes });
                      }}
                    />
                  </label>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {message && <p className="notification-note" role="status">{message}</p>}
    </section>
  );
}
