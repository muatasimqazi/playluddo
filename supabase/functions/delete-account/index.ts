/**
 * Deletes the calling player's account (App Store guideline 5.1.1(v)).
 *
 * Removes their profile photo, revokes Sign in with Apple when the app sent
 * a fresh Apple authorization code, then deletes the auth user. The
 * database follows through its foreign keys: teams they own, team
 * memberships, leaderboard wins and matchmaking entries are deleted; seats
 * in past or running games keep the game intact but lose the link to the
 * account (players.user_id → null).
 *
 * Deploy: supabase functions deploy delete-account
 * Apple revocation needs the Sign in with Apple key as a secret:
 *   supabase secrets set APPLE_PRIVATE_KEY="$(cat AuthKey_UQC983N63K.p8)"
 * Without it the account is still deleted; revocation is skipped and logged.
 *
 * verify_jwt is off in supabase/config.toml; the caller's session is checked
 * here with auth.getUser, which also works with asymmetric JWT signing keys.
 */
import { createClient } from "@supabase/supabase-js";
import { revokeAppleAuthorization } from "./apple.ts";
import { removeAvatarPhotos } from "../_shared/avatarPhotos.ts";

const APPLE_TEAM_ID = Deno.env.get("APPLE_TEAM_ID") ?? "JAK975JG8T";
const APPLE_KEY_ID = Deno.env.get("APPLE_KEY_ID") ?? "UQC983N63K";
// Native iOS Sign in with Apple issues codes for the app's bundle ID.
const APPLE_CLIENT_ID = "com.luddohouse.app";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Sign in first." }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user }, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !user) return json({ error: "Sign in first." }, 401);

  const body = await request.json().catch(() => ({})) as { appleAuthorizationCode?: unknown };

  // Revocation failures never block deletion: the player asked for their
  // data to be gone, and that must not depend on Apple's endpoint.
  let apple: "revoked" | "skipped" | "failed" = "skipped";
  const usesApple = user.identities?.some((identity) => identity.provider === "apple");
  const privateKey = Deno.env.get("APPLE_PRIVATE_KEY");
  if (usesApple && typeof body.appleAuthorizationCode === "string" && body.appleAuthorizationCode) {
    if (!privateKey) {
      console.error("delete-account: APPLE_PRIVATE_KEY is not set; skipped Apple revocation");
    } else {
      try {
        await revokeAppleAuthorization(body.appleAuthorizationCode, {
          teamId: APPLE_TEAM_ID,
          keyId: APPLE_KEY_ID,
          privateKey,
          clientId: APPLE_CLIENT_ID,
        });
        apple = "revoked";
      } catch (error) {
        apple = "failed";
        console.error("delete-account: Apple revocation failed", error);
      }
    }
  }

  try {
    await removeAvatarPhotos(admin, user.id);
  } catch (error) {
    console.error("delete-account: removing photos failed", error);
    return json({ error: "Couldn't delete your account right now. Try again in a moment." }, 500);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("delete-account: deleteUser failed", deleteError);
    return json({ error: "Couldn't delete your account right now. Try again in a moment." }, 500);
  }
  return json({ deleted: true, apple });
});
