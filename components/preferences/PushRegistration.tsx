"use client";

/**
 * Keeps this device's push registration pointed at whoever is signed in, in
 * their current language (F1.7), and opens the right screen when a native
 * notification is tapped. Never asks for permission itself: that only
 * happens from a tap (NotificationSettings, TurnReminderPrompt). Web taps are
 * handled by the service worker (public/sw.js).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PushNotifications } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";
import { pushAvailability, syncPushRegistration } from "@/lib/push";

export function PushRegistration() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const channelName = t("notifications.androidChannel");

  useEffect(() => {
    if (pushAvailability() === "unsupported") return;
    const client = createClient();
    // INITIAL_SESSION covers app start; SIGNED_IN moves the token to a new account.
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        void syncPushRegistration(client, locale, channelName);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [locale, channelName]);

  useEffect(() => {
    if (pushAvailability() !== "native") return;
    const listener = PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const url = (notification.data as { url?: unknown } | undefined)?.url;
      if (typeof url === "string" && url.startsWith("/")) router.push(url);
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [router]);

  return null;
}
