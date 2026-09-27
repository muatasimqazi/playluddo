import { AuthApiError, AuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ensureSession } from "../../lib/supabase/auth";

const existing = { access_token: "existing", user: { id: "signed-in-user" } };
const fresh = { access_token: "fresh", user: { id: "new-anonymous-user" } };

function fakeClient({ user, error, session }: { user?: object | null; error?: unknown; session?: object | null }) {
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: user ?? null }, error: error ?? null })),
    getSession: vi.fn(async () => ({ data: { session: session ?? null } })),
    signOut: vi.fn(async () => ({ error: null })),
    signInAnonymously: vi.fn(async () => ({ data: { session: fresh }, error: null })),
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
}

describe("ensureSession", () => {
  it("returns a healthy session untouched", async () => {
    const { client, auth } = fakeClient({ user: existing.user, session: existing });
    expect(await ensureSession(client)).toBe(existing);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  // The production bug: a transient getUser() failure swapped a signed-in
  // player for a new anonymous user mid-game, losing their seat.
  it.each([
    ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["a rate limit", new AuthApiError("rate limited", 429, "over_request_rate_limit")],
    ["a refresh race between tabs", new AuthApiError("already used", 400, "refresh_token_already_used")],
    ["an unknown error", new Error("boom")],
  ])("keeps the existing session through %s", async (_, error) => {
    const { client, auth } = fakeClient({ error, session: existing });
    expect(await ensureSession(client)).toBe(existing);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it.each(["user_not_found", "session_not_found", "bad_jwt", "refresh_token_not_found"])(
    "replaces a session the auth server reports gone (%s), clearing only this browser",
    async (code) => {
      const { client, auth } = fakeClient({ error: new AuthApiError("gone", 403, code), session: existing });
      expect(await ensureSession(client)).toBe(fresh);
      expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(auth.signInAnonymously).toHaveBeenCalledOnce();
    },
  );

  it("signs in anonymously when there is no session at all", async () => {
    const { client, auth } = fakeClient({ error: new AuthApiError("missing", 400, "no_authorization") });
    expect(await ensureSession(client)).toBe(fresh);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
