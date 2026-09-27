import { isAuthApiError, type SupabaseClient } from "@supabase/supabase-js";

// Auth-server answers meaning the cached session can never work again (the
// user or session was deleted, or the JWT is from a different project/reset
// database). Anything else — a network blip, a rate limit, a token-refresh
// race between tabs — is transient and must NOT cost the player their
// identity.
const GONE_SESSION_CODES = new Set([
  "user_not_found",
  "session_not_found",
  "bad_jwt",
  "refresh_token_not_found",
]);

/**
 * MVP identity (PRD 1.3: "lightweight player identity", no full account
 * system) — anonymous Supabase Auth. Every RPC's `auth.uid()` check relies
 * on a session existing; this guarantees one before any RPC is called.
 *
 * Requires `enable_anonymous_sign_ins = true` (supabase/config.toml locally;
 * the equivalent dashboard toggle on a hosted project).
 *
 * Uses `getUser()`, not just `getSession()`, to check the cached session:
 * `getSession()` only reads the cached JWT and checks its expiry, so after a
 * `supabase db reset` (which wipes `auth.users`) a leftover anonymous session
 * still looks valid while every RPC fails a foreign-key check against a user
 * row that no longer exists. When the auth server definitively reports the
 * session gone (GONE_SESSION_CODES), it's replaced with a fresh anonymous
 * one — that self-heals instead of needing site data cleared. Any other
 * getUser() failure keeps the existing session: identity must never be
 * swapped over a transient error.
 */
export async function ensureSession(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  const {
    data: { session },
  } = await client.auth.getSession();

  if (!error && data.user && session) return session;

  // Keep an existing session through anything short of a definitive "this
  // session is gone". Replacing it on any getUser() error used to swap a
  // signed-in player for a brand-new anonymous user mid-game (seen in
  // production: every seat RPC then failed SEAT_NOT_CONTROLLED and the seat
  // timed out to a computer).
  if (session && !(isAuthApiError(error) && error.code && GONE_SESSION_CODES.has(error.code))) {
    return session;
  }

  // No session at all, or one the auth server says no longer exists — start
  // fresh. Local scope: only this browser's stale session is cleared, never
  // the account's sessions on other devices.
  if (session) await client.auth.signOut({ scope: "local" }).catch(() => {});
  const { data: signInData, error: signInError } = await client.auth.signInAnonymously();
  if (signInError) throw signInError;
  return signInData.session;
}
