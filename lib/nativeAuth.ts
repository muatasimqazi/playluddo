import { Capacitor } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SocialLogin,
  type AppleProviderResponse,
  type GoogleLoginResponseOnline,
} from "@capgo/capacitor-social-login";

/**
 * Native Sign in with Apple (iOS) and Google (iOS and Android) in the app
 * (@capgo/capacitor-social-login). Each provider's own sheet returns an ID
 * token that Supabase verifies directly (auth.signInWithIdToken), so —
 * unlike the website — there's no redirect through a browser (Google blocks
 * its web sign-in inside the app's web view anyway).
 *
 * Supabase must list these tokens' audiences as allowed client IDs: the
 * bundle ID (com.luddohouse.app) for Apple, and GOOGLE_IOS_CLIENT_ID and
 * GOOGLE_WEB_CLIENT_ID for Google. Google's reversed iOS client ID is also a
 * URL scheme in Info.plist.
 *
 * Android uses Google's Credential Manager, which issues tokens for the Web
 * client ID. It only works for builds whose signing key is registered: an
 * Android OAuth client in the same Google Cloud project, with package name
 * com.luddohouse.app and the SHA-1 of each signing key (debug, upload, and
 * Play App Signing).
 */
const GOOGLE_IOS_CLIENT_ID = "1026111066835-o0o0docc4rthuaefvijv1nv0eik4aohk.apps.googleusercontent.com";
const GOOGLE_WEB_CLIENT_ID = "1026111066835-sp4142q1o5keumfpk36e32eq3i8r3rt5.apps.googleusercontent.com";

export function nativeAppleSignInAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function nativeGoogleSignInAvailable() {
  return Capacitor.isNativePlatform() && ["ios", "android"].includes(Capacitor.getPlatform());
}

export type NativeSignIn =
  | { status: "signed-in" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

let initialized: Promise<void> | null = null;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function initialize() {
  try {
    initialized ??= SocialLogin.initialize({
      // Sign in with Apple is iOS-only here. On Android the plugin would need
      // a web redirect flow, and rejects the whole initialize without one.
      ...(Capacitor.getPlatform() === "ios" ? { apple: { clientId: "com.luddohouse.app" } } : {}),
      google: { iOSClientId: GOOGLE_IOS_CLIENT_ID, webClientId: GOOGLE_WEB_CLIENT_ID, mode: "online" },
    });
    await initialized;
    return true;
  } catch {
    initialized = null;
    return false;
  }
}

const isCancel = (error: unknown) =>
  /1001|cancel/i.test(error instanceof Error ? error.message : String(error));

export async function signInWithAppleNative(client: SupabaseClient): Promise<NativeSignIn> {
  if (!(await initialize())) {
    return { status: "failed", message: "Sign in with Apple isn't available right now." };
  }

  // Apple signs the SHA-256 of the nonce into the ID token; Supabase gets
  // the raw value and checks it matches, so a token can't be replayed.
  const nonce = crypto.randomUUID();
  let apple: AppleProviderResponse;
  try {
    const login = await SocialLogin.login({
      provider: "apple",
      options: { scopes: ["email", "name"], nonce: await sha256Hex(nonce) },
    });
    apple = login.result as AppleProviderResponse;
  } catch (error) {
    // ASAuthorizationError.canceled (1001): the player closed Apple's sheet.
    if (isCancel(error)) return { status: "cancelled" };
    return { status: "failed", message: "Sign in with Apple didn't finish. Try again in a moment." };
  }
  if (!apple.idToken) {
    return { status: "failed", message: "Sign in with Apple didn't finish. Try again in a moment." };
  }

  const { data, error } = await client.auth.signInWithIdToken({
    provider: "apple",
    token: apple.idToken,
    nonce,
  });
  if (error) return { status: "failed", message: error.message };

  // Apple shares the player's name only on their very first sign-in, and
  // never inside the ID token — keep it as the starting display name.
  const name = [apple.profile.givenName, apple.profile.familyName].filter(Boolean).join(" ").trim();
  if (name && !data.user?.user_metadata?.display_name) {
    await client.auth.updateUser({ data: { display_name: name.slice(0, 24) } }).catch(() => {});
  }
  return { status: "signed-in" };
}

export async function signInWithGoogleNative(client: SupabaseClient): Promise<NativeSignIn> {
  if (!(await initialize())) {
    return { status: "failed", message: "Google sign-in isn't available right now." };
  }

  // Same replay protection as Apple: Google embeds the hashed nonce in the
  // ID token and Supabase checks it against the raw value.
  const nonce = crypto.randomUUID();
  let google: GoogleLoginResponseOnline;
  try {
    const login = await SocialLogin.login({
      provider: "google",
      options: {
        // Android's Credential Manager ID token already carries email and
        // profile; asking for scopes there needs a custom MainActivity.
        ...(Capacitor.getPlatform() === "ios" ? { scopes: ["email", "profile"] } : {}),
        nonce: await sha256Hex(nonce),
      },
    });
    google = login.result as GoogleLoginResponseOnline;
  } catch (error) {
    if (isCancel(error)) return { status: "cancelled" };
    return { status: "failed", message: "Google sign-in didn't finish. Try again in a moment." };
  }
  if (!google.idToken) {
    return { status: "failed", message: "Google sign-in didn't finish. Try again in a moment." };
  }

  const { error } = await client.auth.signInWithIdToken({
    provider: "google",
    token: google.idToken,
    // Google's ID token carries an at_hash of the access token. Android's
    // Credential Manager may return no access token; the ID token is enough.
    access_token: google.accessToken?.token ?? undefined,
    nonce,
  });
  return error ? { status: "failed", message: error.message } : { status: "signed-in" };
}

/**
 * Asks Apple to confirm once more and returns a fresh authorization code,
 * which the delete-account function exchanges and revokes (Apple requires
 * revoking Sign in with Apple when the account is deleted). The code is
 * short-lived, so ask for it right before use.
 */
export async function appleAuthorizationCode(): Promise<
  { status: "ok"; code: string } | { status: "cancelled" } | { status: "failed" }
> {
  if (!(await initialize())) return { status: "failed" };
  try {
    const login = await SocialLogin.login({ provider: "apple", options: { scopes: [] } });
    // Without useProperTokenExchange the plugin returns Apple's
    // authorization code as accessToken.token.
    const code = (login.result as AppleProviderResponse).accessToken?.token;
    return code ? { status: "ok", code } : { status: "failed" };
  } catch (error) {
    return isCancel(error) ? { status: "cancelled" } : { status: "failed" };
  }
}
