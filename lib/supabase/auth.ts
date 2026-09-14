import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MVP identity (PRD 1.3: "lightweight player identity", no full account
 * system) — anonymous Supabase Auth. Every RPC's `auth.uid()` check relies
 * on a session existing; this guarantees one before any RPC is called.
 *
 * Requires `enable_anonymous_sign_ins = true` (supabase/config.toml locally;
 * the equivalent dashboard toggle on a hosted project).
 *
 * Uses `getUser()`, not `getSession()`, to decide whether the cached session
 * is usable. `getSession()` reads the cached JWT from local storage and only
 * checks its own expiry — it never confirms the user it names still exists
 * server-side. `getUser()` makes a real round-trip to the Auth server and
 * fails if that user is gone. That distinction is exactly what was missing
 * here: a cached anonymous session surviving in a browser's local storage
 * across a `supabase db reset` (which wipes `auth.users`) still looks valid
 * to `getSession()`, so every RPC's `insert ... user_id = auth.uid()` then
 * fails a foreign-key check against a user row that no longer exists. This
 * makes that self-heal — a stale session is detected and replaced — instead
 * of requiring the user to manually clear site data.
 */
export async function ensureSession(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (!error && data.user) {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (session) return session;
  }

  // No session, or the cached one names a user the server no longer knows
  // about — clear it and start fresh rather than let every subsequent RPC
  // fail on a foreign-key violation.
  await client.auth.signOut().catch(() => {});
  const { data: signInData, error: signInError } = await client.auth.signInAnonymously();
  if (signInError) throw signInError;
  return signInData.session;
}
