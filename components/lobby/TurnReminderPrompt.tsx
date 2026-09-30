"use client";

/**
 * A one-line offer in the online lobby to be notified when it's your turn
 * (F1.7), the moment the question makes sense. Shown only while this device
 * isn't set up for notifications yet; "Not now" hides it on this device for
 * good, and the profile panel's Notifications section remains the way back.
 */
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useI18n } from "@/lib/i18n";
import { enablePush, pushAvailability, pushOnHere, pushPermission, pushTurnedOffHere } from "@/lib/push";

const DISMISSED_KEY = "luddo-push-prompt-dismissed";

export function TurnReminderPrompt({ client }: { client: SupabaseClient }) {
  const { t, locale } = useI18n();
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {}
    if (dismissed || pushTurnedOffHere() || pushAvailability() === "unsupported") return;
    // Offered until this device is actually registered, unless the player
    // blocked notifications in the system settings.
    void Promise.all([pushPermission(), pushOnHere()]).then(([permission, on]) => {
      if (!cancelled) setVisible(permission !== "denied" && !on);
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {}
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="lobby-push-prompt" role="group" aria-label={t("notifications.heading")}>
      <span>{t("notifications.lobbyPrompt")}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void enablePush(client, locale, t("notifications.androidChannel"))
            .catch(() => "error")
            .finally(() => {
              setPending(false);
              setVisible(false);
            });
        }}
      >
        {t("notifications.lobbyPromptAction")}
      </button>
      <button type="button" className="is-quiet" onClick={dismiss}>
        {t("notifications.lobbyPromptDismiss")}
      </button>
    </div>
  );
}
