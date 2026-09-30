/**
 * Push notifications on this device (docs/COMPETITIVE_ROADMAP.md F1.7).
 *
 * The iOS and Android apps use @capacitor/push-notifications (APNs and FCM
 * tokens); the web uses a service worker (public/sw.js) and Web Push. Either
 * way the result is a destination registered against the current Supabase
 * user with register_push_device, along with the device's language and time
 * zone, which the server uses for the copy and for quiet hours. What gets
 * sent, and when, is decided on the server
 * (supabase/migrations/20260930140000_push_notifications.sql).
 *
 * The system permission prompt is only ever shown from enablePush(), which
 * callers run from a tap. syncPushRegistration() runs quietly on start and
 * on sign-in, and only when permission is already granted, so a token that
 * moves to a newly signed-in account follows it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

export type PushAvailability = "native" | "web" | "unsupported";
export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

/** Must match ANDROID_CHANNEL_ID in supabase/functions/push-dispatch/fcm.ts. */
export const ANDROID_CHANNEL_ID = "table";

const OFF_KEY = "luddo-push-off";
// Set once this device has had a push token. Native registration crashes the
// app outright when Firebase isn't configured (no google-services.json on
// Android), and Android 12 and older grant permission without asking, so the
// quiet sync on launch only re-registers a device that has worked before.
const REGISTERED_KEY = "luddo-push-registered";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export function pushAvailability(): PushAvailability {
  if (typeof window === "undefined") return "unsupported";
  if (Capacitor.isNativePlatform()) return "native";
  if (
    VAPID_PUBLIC_KEY &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  ) {
    return "web";
  }
  return "unsupported";
}

/** iOS Safari only offers Web Push to a site added to the Home Screen. */
export function needsHomeScreenInstall(): boolean {
  if (typeof window === "undefined" || Capacitor.isNativePlatform()) return false;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
  return iOS && !standalone;
}

export async function pushPermission(): Promise<PushPermission> {
  switch (pushAvailability()) {
    case "native": {
      const { receive } = await PushNotifications.checkPermissions();
      return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
    }
    case "web":
      return Notification.permission === "default" ? "prompt" : Notification.permission;
    default:
      return "unsupported";
  }
}

/** Whether the player turned notifications off on this device. */
export function pushTurnedOffHere(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function registeredBefore(): boolean {
  try {
    return localStorage.getItem(REGISTERED_KEY) === "1";
  } catch {
    return false;
  }
}

function setRegisteredBefore() {
  try {
    localStorage.setItem(REGISTERED_KEY, "1");
  } catch {}
}

function setTurnedOffHere(off: boolean) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch {}
}

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// --- Native ------------------------------------------------------------------

let nativeToken: string | null = null;
let nativeTokenWaiters: ((token: string | null) => void)[] = [];
let nativeListenersAdded = false;

async function addNativeRegistrationListeners() {
  if (nativeListenersAdded) return;
  nativeListenersAdded = true;
  await PushNotifications.addListener("registration", ({ value }) => {
    nativeToken = value;
    setRegisteredBefore();
    nativeTokenWaiters.forEach((resolve) => resolve(value));
    nativeTokenWaiters = [];
  });
  await PushNotifications.addListener("registrationError", (error) => {
    console.warn("Push registration failed", error.error);
    nativeTokenWaiters.forEach((resolve) => resolve(null));
    nativeTokenWaiters = [];
  });
}

async function registerNative(channelName: string): Promise<string | null> {
  await addNativeRegistrationListeners();
  if (Capacitor.getPlatform() === "android") {
    await PushNotifications.createChannel({
      id: ANDROID_CHANNEL_ID,
      name: channelName,
      importance: 4,
      visibility: 1,
    }).catch(() => {});
  }
  const token = new Promise<string | null>((resolve) => {
    nativeTokenWaiters.push(resolve);
    setTimeout(() => resolve(nativeToken), 10_000);
  });
  await PushNotifications.register();
  return token;
}

// --- Web ---------------------------------------------------------------------

function applicationServerKey(base64Url: string) {
  const base64 = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function webSubscription(create: boolean): Promise<PushSubscription | null> {
  const registration =
    (await navigator.serviceWorker.getRegistration("/")) ??
    (create ? await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }) : undefined);
  if (!registration) return null;
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing || !create) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(VAPID_PUBLIC_KEY!),
  });
}

// --- Registration ------------------------------------------------------------

async function registerDestination(client: SupabaseClient, locale: string, create: boolean, channelName: string) {
  const common = { p_locale: locale, p_time_zone: deviceTimeZone() };
  if (pushAvailability() === "native") {
    const token = await registerNative(channelName);
    if (!token) return false;
    const { error } = await client.rpc("register_push_device", {
      p_platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
      p_token: token,
      ...common,
    });
    return !error;
  }
  const subscription = await webSubscription(create);
  const keys = subscription?.toJSON().keys;
  if (!subscription || !keys?.p256dh || !keys.auth) return false;
  const { error } = await client.rpc("register_push_device", {
    p_platform: "web",
    p_token: subscription.endpoint,
    p_web_p256dh: keys.p256dh,
    p_web_auth: keys.auth,
    ...common,
  });
  return !error;
}

/**
 * Asks for permission if needed (call from a tap) and registers this device.
 * Resolves to the permission that resulted.
 */
export async function enablePush(
  client: SupabaseClient,
  locale: string,
  channelName: string,
): Promise<PushPermission> {
  const availability = pushAvailability();
  if (availability === "unsupported") return "unsupported";

  let permission: PushPermission;
  if (availability === "native") {
    const { receive } = await PushNotifications.requestPermissions();
    permission = receive === "granted" ? "granted" : "denied";
  } else {
    const result = await Notification.requestPermission();
    permission = result === "default" ? "prompt" : result;
  }
  if (permission !== "granted") return permission;

  setTurnedOffHere(false);
  const ok = await registerDestination(client, locale, true, channelName);
  if (!ok) throw new Error("Couldn't register this device for notifications.");
  return permission;
}

/** Re-registers quietly when permission is already granted (start, sign-in, language change). */
export async function syncPushRegistration(client: SupabaseClient, locale: string, channelName: string) {
  if (pushTurnedOffHere() || (await pushPermission()) !== "granted") return;
  if (pushAvailability() === "native" && !registeredBefore()) return;
  const { data } = await client.auth.getSession();
  if (!data.session) return;
  await registerDestination(client, locale, false, channelName).catch(() => false);
}

/**
 * Whether this device is actually set up to receive notifications: permission
 * alone isn't enough (Android 12 and older grant it without asking), it must
 * also have registered with the push service.
 */
export async function pushOnHere(): Promise<boolean> {
  if (pushTurnedOffHere() || (await pushPermission()) !== "granted") return false;
  if (pushAvailability() === "native") return registeredBefore();
  return !!(await webSubscription(false).catch(() => null));
}

/** Stops notifications to this device, whoever is signed in. */
export async function disablePushOnThisDevice(client: SupabaseClient) {
  setTurnedOffHere(true);
  if (pushAvailability() === "native") {
    if (nativeToken) await client.rpc("unregister_push_device", { p_token: nativeToken });
    await PushNotifications.unregister().catch(() => {});
    nativeToken = null;
    return;
  }
  const subscription = await webSubscription(false).catch(() => null);
  if (subscription) {
    await client.rpc("unregister_push_device", { p_token: subscription.endpoint });
    await subscription.unsubscribe().catch(() => false);
  }
}

// --- Settings ----------------------------------------------------------------

export interface NotificationSettings {
  turn: boolean;
  rematch: boolean;
  friendTable: boolean;
  teamTable: boolean;
  quietEnabled: boolean;
  /** Minutes after local midnight. */
  quietStart: number;
  quietEnd: number;
}

export async function getNotificationSettings(client: SupabaseClient): Promise<NotificationSettings> {
  const { data, error } = await client.rpc("get_notification_settings");
  if (error) throw error;
  return data as NotificationSettings;
}

export async function setNotificationSettings(
  client: SupabaseClient,
  patch: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const { data, error } = await client.rpc("set_notification_settings", { p_settings: patch });
  if (error) throw error;
  return data as NotificationSettings;
}

// --- Background reporting ----------------------------------------------------

/**
 * Tells the server whether this seat's app is in the background, so a
 * "your turn" alert only goes to someone who isn't already looking.
 */
export function reportSeatBackgrounded(client: SupabaseClient, roomId: string, backgrounded: boolean) {
  return client
    .rpc("set_seat_backgrounded", { p_room_id: roomId, p_backgrounded: backgrounded })
    .then(() => undefined, () => undefined);
}
