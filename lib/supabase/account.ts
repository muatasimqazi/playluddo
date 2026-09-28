import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Permanently deletes the signed-in player's account through the
 * delete-account Edge Function (profile, photo, wins, teams; see
 * supabase/functions/delete-account). Pass a fresh Apple authorization code
 * for accounts that use Sign in with Apple so it can be revoked. Returns an
 * error message, or null once the account is gone and signed out here.
 */
export async function deleteAccount(
  client: SupabaseClient,
  { appleAuthorizationCode }: { appleAuthorizationCode?: string } = {},
): Promise<string | null> {
  const { data, error } = await client.functions.invoke<{ deleted: boolean }>("delete-account", {
    body: appleAuthorizationCode ? { appleAuthorizationCode } : {},
  });
  if (error || !data?.deleted) return "Couldn't delete your account right now. Try again in a moment.";
  // The session's user no longer exists; drop it so the next action starts
  // a fresh guest session.
  await client.auth.signOut({ scope: "local" }).catch(() => {});
  return null;
}
