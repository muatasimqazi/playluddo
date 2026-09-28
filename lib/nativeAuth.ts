import { Capacitor } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SocialLogin, type AppleProviderResponse } from "@capgo/capacitor-social-login";

/**
 * Native Sign in with Apple in the iOS app (@capgo/capacitor-social-login).
 * Apple's own sheet returns an ID token that Supabase verifies directly
 * (auth.signInWithIdToken), so — unlike the website — there's no redirect
 * through a browser. Supabase's Apple provider lists the bundle ID
 * (com.luddohouse.app) as an allowed client ID for these tokens.
 */
export function nativeAppleSignInAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
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

export async function signInWithAppleNative(client: SupabaseClient): Promise<NativeSignIn> {
  try {
    initialized ??= SocialLogin.initialize({ apple: { clientId: "com.luddohouse.app" } });
    await initialized;
  } catch {
    initialized = null;
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
    const message = error instanceof Error ? error.message : String(error);
    if (/1001|cancel/i.test(message)) return { status: "cancelled" };
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
