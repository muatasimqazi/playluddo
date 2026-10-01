/**
 * The 30-day rule for signed-in under-13 accounts (F0.4, decision 13).
 *
 * Woken once a day by the purge-inactive-under13-accounts cron job, which
 * must present UNDER13_PURGE_SECRET. Asks under13_purge_candidates() which
 * signed-in accounts answered under 13 and have been inactive for 30 days,
 * then for each removes its profile photos and deletes the account; the
 * database follows through its foreign keys as for any deleted account.
 * Guests with an under-13 answer are deleted in SQL, since they can't upload
 * photos.
 *
 * Sign in with Apple isn't revoked here: revoking needs a fresh authorization
 * code from the player's device, which a background job never has.
 * Deleting the account still ends the link on our side.
 *
 * An account whose photos can't be removed is kept and retried tomorrow,
 * never deleted with its photos left behind.
 *
 * Deploy: supabase functions deploy purge-under13-accounts
 * Secrets: UNDER13_PURGE_SECRET (and the same value in Vault, see
 * supabase/migrations/20260930190000_purge_inactive_under13_accounts.sql).
 */
import { createClient } from "@supabase/supabase-js";
import { removeAvatarPhotos } from "../_shared/avatarPhotos.ts";

const BATCH = 100;

function timingSafeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("UNDER13_PURGE_SECRET");
  const presented = request.headers.get("x-purge-secret") ?? "";
  if (!secret || !timingSafeEqual(presented, secret)) {
    return new Response("Forbidden", { status: 403 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: candidates, error } = await admin.rpc("under13_purge_candidates", { p_limit: BATCH });
  if (error) {
    console.error("purge-under13-accounts: listing candidates failed", error);
    return Response.json({ error: "Couldn't list accounts" }, { status: 500 });
  }

  let deleted = 0;
  let failed = 0;
  for (const userId of (candidates ?? []) as string[]) {
    try {
      await removeAvatarPhotos(admin, userId);
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) throw deleteError;
      deleted += 1;
    } catch (failure) {
      failed += 1;
      // Never log the id alongside anything about age.
      console.error("purge-under13-accounts: one account could not be deleted", failure);
    }
  }
  return Response.json({ deleted, failed });
});
