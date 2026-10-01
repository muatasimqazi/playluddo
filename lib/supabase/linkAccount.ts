import type {
  AuthError,
  Provider,
  SignInWithIdTokenCredentials,
  SupabaseClient,
} from "@supabase/supabase-js";

/**
 * Signing in as a guest converts the guest instead of replacing it (F0.4,
 * Section 15 R3). A guest is an anonymous Supabase user; linking the new
 * sign-in to that user keeps the same user id, so the guest's age answer —
 * and their seat, stats and preferences — carry over to the account.
 *
 * Linking only works for an identity nobody has yet. When the email, phone or
 * Google/Apple identity already belongs to an account, this is an account
 * switch, not a conversion: each helper falls back to an ordinary sign-in,
 * and nothing from the guest is copied to that account.
 *
 * Needs manual linking enabled (supabase/config.toml
 * `enable_manual_linking`, or the dashboard's Auth → Providers toggle on a
 * hosted project). While it's off, linking fails and every path falls back to
 * the plain sign-in it replaced.
 */

export async function isGuest(client: SupabaseClient): Promise<boolean> {
  const {
    data: { session },
  } = await client.auth.getSession();
  return !!session?.user.is_anonymous;
}

/** Native Apple or Google sign-in (an ID token from the platform's sheet). */
export async function signInOrLinkWithIdToken(
  client: SupabaseClient,
  credentials: SignInWithIdTokenCredentials,
) {
  if (await isGuest(client)) {
    const linked = await client.auth.linkIdentity(credentials);
    if (!linked.error) return linked;
  }
  return client.auth.signInWithIdToken(credentials);
}

// Web OAuth leaves the page, so the provider is remembered across the
// redirect in case linking comes back refused (resumeFailedOAuthLink).
const PENDING_LINK_KEY = "luddo.pendingOAuthLink";
const PENDING_LINK_TTL_MS = 10 * 60 * 1000;

/** Web Google or Apple sign-in, via a redirect to the provider. */
export async function signInOrLinkWithOAuth(
  client: SupabaseClient,
  provider: Provider,
  redirectTo: string,
): Promise<{ error: AuthError | null }> {
  if (await isGuest(client)) {
    rememberPendingLink(provider);
    const { error } = await client.auth.linkIdentity({ provider, options: { redirectTo } });
    if (!error) return { error: null };
    forgetPendingLink();
  }
  const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
  return { error };
}

/**
 * Run once on page load. When a web OAuth link came back refused because the
 * identity already has an account, sign in to that account instead (a second
 * trip to the provider, which usually returns straight away).
 */
export async function resumeFailedOAuthLink(client: SupabaseClient, redirectTo: string) {
  const provider = takePendingLink();
  if (!provider) return;
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const errorCode = url.searchParams.get("error_code") ?? hash.get("error_code");
  if (!errorCode) return;

  for (const key of ["error", "error_code", "error_description"]) url.searchParams.delete(key);
  if (hash.has("error_code")) url.hash = "";
  window.history.replaceState(window.history.state, "", url);

  if (linkRefusedAsTaken(errorCode)) {
    await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
  }
}

/** The identity, email or phone already belongs to another account. */
export function linkRefusedAsTaken(code: string | undefined): boolean {
  return (
    code === "identity_already_exists" ||
    code === "email_exists" ||
    code === "phone_exists" ||
    code === "user_already_exists"
  );
}

export type CodeMethod = "email" | "phone";

/**
 * Sends a one-time code (and, for email, a link). For a guest it first tries
 * adding the email or phone to the guest itself; `linking` says which kind of
 * code was sent, which verifySignInCode needs.
 */
export async function sendSignInCode(
  client: SupabaseClient,
  method: CodeMethod,
  destination: string,
  emailRedirectTo: string,
): Promise<{ error: AuthError | null; linking: boolean }> {
  if (await isGuest(client)) {
    const { error } = await client.auth.updateUser(
      method === "email" ? { email: destination } : { phone: destination },
      method === "email" ? { emailRedirectTo } : undefined,
    );
    if (!error) return { error: null, linking: true };
  }
  const { error } = await client.auth.signInWithOtp(
    method === "email"
      ? { email: destination, options: { shouldCreateUser: true, emailRedirectTo } }
      : { phone: destination, options: { shouldCreateUser: true } },
  );
  return { error, linking: false };
}

export function verifySignInCode(
  client: SupabaseClient,
  method: CodeMethod,
  destination: string,
  token: string,
  linking: boolean,
) {
  return client.auth.verifyOtp(
    method === "email"
      ? { email: destination, token, type: linking ? "email_change" : "email" }
      : { phone: destination, token, type: linking ? "phone_change" : "sms" },
  );
}

function rememberPendingLink(provider: Provider) {
  try {
    sessionStorage.setItem(PENDING_LINK_KEY, JSON.stringify({ provider, at: Date.now() }));
  } catch {
    /* Without storage a refused link just leaves the player a guest. */
  }
}

function forgetPendingLink() {
  try {
    sessionStorage.removeItem(PENDING_LINK_KEY);
  } catch {
    /* Nothing to forget. */
  }
}

function takePendingLink(): Provider | null {
  try {
    const raw = sessionStorage.getItem(PENDING_LINK_KEY);
    sessionStorage.removeItem(PENDING_LINK_KEY);
    if (!raw) return null;
    const { provider, at } = JSON.parse(raw) as { provider?: Provider; at?: number };
    if (!provider || typeof at !== "number" || Date.now() - at > PENDING_LINK_TTL_MS) return null;
    return provider;
  } catch {
    return null;
  }
}
