/**
 * Game Center sign-in for the iOS app (Supabase Auth has no Game Center
 * provider). The app posts the identity proof GameKit gives it; once the
 * proof checks out against Apple's key, the player's account is found — or
 * created, the first time — and the app gets a one-time magic-link token it
 * redeems with auth.verifyOtp({ token_hash, type: "magiclink" }) for an
 * ordinary session. No email is ever sent.
 *
 * Each Game Center player maps to one account through a stable, private
 * placeholder address derived from their team player ID, so signing in again
 * (or on another iPhone with the same Game Center account) lands in the same
 * account.
 *
 * A guest (anonymous session) signing in for the first time with a Game
 * Center player that has no account yet is converted rather than replaced
 * (F0.4, Section 15 R3): the placeholder address is added to the guest's own
 * user, so the user id — and the guest's age answer, seat and stats — carry
 * over. If that Game Center player already has an account, the guest signs in
 * to it instead and nothing is copied across.
 *
 * Deploy: supabase functions deploy game-center-sign-in
 * (verify_jwt is off in supabase/config.toml — the Game Center proof is the
 * credential here, and the caller may not have a session yet.)
 */
import { createClient } from "@supabase/supabase-js";
import { type GameCenterProof, ProofError, verifyGameCenterProof } from "./verify.ts";

const BUNDLE_ID = "com.luddohouse.app";

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

async function accountEmail(teamPlayerId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(teamPlayerId));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `gamecenter+${hex.slice(0, 32)}@luddohouse.com`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { proof?: GameCenterProof; displayName?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Malformed proof" }, 400);
  }

  let teamPlayerId: string;
  try {
    teamPlayerId = await verifyGameCenterProof(body.proof as GameCenterProof, { bundleId: BUNDLE_ID });
  } catch (error) {
    if (error instanceof ProofError) return json({ error: error.message }, 401);
    console.error("game-center-sign-in: verification failed", error);
    return json({ error: "Could not verify Game Center right now." }, 502);
  }

  const admin = adminClient();
  const email = await accountEmail(teamPlayerId);
  // Only a starting name for a new account; the player can change it.
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 24) : "";

  if (await convertGuest(admin, request, email, displayName)) {
    return magicLink(admin, email);
  }

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { game_center: true },
    user_metadata: displayName ? { display_name: displayName } : {},
  });
  if (createError && createError.code !== "email_exists") {
    console.error("game-center-sign-in: createUser failed", createError);
    return json({ error: "Could not sign in right now." }, 500);
  }

  return magicLink(admin, email);
});

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
type Admin = ReturnType<typeof adminClient>;

async function magicLink(admin: Admin, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) {
    console.error("game-center-sign-in: generateLink failed", error);
    return json({ error: "Could not sign in right now." }, 500);
  }
  return json({ tokenHash: data.properties.hashed_token });
}

/**
 * Adds the Game Center address to the caller's own user when the caller is a
 * guest. Confirming an email on an anonymous user makes it a permanent one.
 * Returns false (nothing changed) for a signed-in or missing caller, or when
 * the address already belongs to an account.
 */
async function convertGuest(admin: Admin, request: Request, email: string, displayName: string) {
  const jwt = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await admin.auth.getUser(jwt);
  const guest = data.user;
  if (!guest?.is_anonymous) return false;

  const { error } = await admin.auth.admin.updateUserById(guest.id, {
    email,
    email_confirm: true,
    app_metadata: { game_center: true },
    // Keep a name the guest already chose; otherwise start from Game Center's.
    ...(displayName && !guest.user_metadata?.display_name
      ? { user_metadata: { display_name: displayName } }
      : {}),
  });
  if (error) {
    if (error.code !== "email_exists") console.error("game-center-sign-in: convert failed", error);
    return false;
  }
  return true;
}
