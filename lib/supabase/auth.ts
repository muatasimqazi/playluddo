import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MVP identity (PRD 1.3: "lightweight player identity", no full account
 * system) — anonymous Supabase Auth. Every RPC's `auth.uid()` check relies
 * on a session existing; this guarantees one before any RPC is called.
 *
 * Requires `enable_anonymous_sign_ins = true` (supabase/config.toml locally;
 * the equivalent dashboard toggle on a hosted project).
 */
export async function ensureSession(client: SupabaseClient) {
  const {
    data: { session },
  } = await client.auth.getSession();
  if (session) return session;

  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return data.session;
}
