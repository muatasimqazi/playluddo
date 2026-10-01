import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  linkRefusedAsTaken,
  sendSignInCode,
  signInOrLinkWithIdToken,
  verifySignInCode,
} from "../../lib/supabase/linkAccount";

const taken = { code: "identity_already_exists", message: "already linked" };

function fakeClient({ anonymous, linkError = null }: { anonymous: boolean | null; linkError?: unknown }) {
  const auth = {
    getSession: vi.fn(async () => ({
      data: { session: anonymous === null ? null : { user: { is_anonymous: anonymous } } },
    })),
    linkIdentity: vi.fn(async () => ({ data: {}, error: linkError })),
    signInWithIdToken: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async () => ({ data: {}, error: linkError })),
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
}

const apple = { provider: "apple" as const, token: "id-token", nonce: "n" };

describe("native ID-token sign-in", () => {
  it("links a guest, keeping their user id", async () => {
    const { client, auth } = fakeClient({ anonymous: true });
    await signInOrLinkWithIdToken(client, apple);
    expect(auth.linkIdentity).toHaveBeenCalledWith(apple);
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });
  it("signs in to the existing account when the identity is taken", async () => {
    const { client, auth } = fakeClient({ anonymous: true, linkError: taken });
    await signInOrLinkWithIdToken(client, apple);
    expect(auth.signInWithIdToken).toHaveBeenCalledWith(apple);
  });
  it("never links for a signed-in player or no session (account switch)", async () => {
    for (const anonymous of [false, null]) {
      const { client, auth } = fakeClient({ anonymous });
      await signInOrLinkWithIdToken(client, apple);
      expect(auth.linkIdentity).not.toHaveBeenCalled();
      expect(auth.signInWithIdToken).toHaveBeenCalledWith(apple);
    }
  });
});

describe("email and phone codes", () => {
  it("adds the email to a guest and verifies it as an email change", async () => {
    const { client, auth } = fakeClient({ anonymous: true });
    const sent = await sendSignInCode(client, "email", "a@b.co", "https://x/");
    expect(sent).toEqual({ error: null, linking: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ email: "a@b.co" }, { emailRedirectTo: "https://x/" });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();

    await verifySignInCode(client, "email", "a@b.co", "12345678", sent.linking);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "a@b.co", token: "12345678", type: "email_change" });
  });
  it("adds the phone to a guest and verifies it as a phone change", async () => {
    const { client, auth } = fakeClient({ anonymous: true });
    const sent = await sendSignInCode(client, "phone", "+15550100", "https://x/");
    expect(auth.updateUser).toHaveBeenCalledWith({ phone: "+15550100" }, undefined);
    await verifySignInCode(client, "phone", "+15550100", "123456", sent.linking);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: "+15550100", token: "123456", type: "phone_change" });
  });
  it("falls back to an ordinary sign-in code when the email has an account", async () => {
    const { client, auth } = fakeClient({ anonymous: true, linkError: { code: "email_exists" } });
    const sent = await sendSignInCode(client, "email", "a@b.co", "https://x/");
    expect(sent.linking).toBe(false);
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.co",
      options: { shouldCreateUser: true, emailRedirectTo: "https://x/" },
    });
    await verifySignInCode(client, "email", "a@b.co", "12345678", sent.linking);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "a@b.co", token: "12345678", type: "email" });
  });
  it("sends an ordinary code to a signed-in player", async () => {
    const { client, auth } = fakeClient({ anonymous: false });
    const sent = await sendSignInCode(client, "phone", "+15550100", "https://x/");
    expect(sent.linking).toBe(false);
    expect(auth.updateUser).not.toHaveBeenCalled();
    await verifySignInCode(client, "phone", "+15550100", "123456", sent.linking);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: "+15550100", token: "123456", type: "sms" });
  });
});

describe("linkRefusedAsTaken", () => {
  it("recognizes the taken-identity codes only", () => {
    for (const code of ["identity_already_exists", "email_exists", "phone_exists", "user_already_exists"])
      expect(linkRefusedAsTaken(code)).toBe(true);
    expect(linkRefusedAsTaken("manual_linking_disabled")).toBe(false);
    expect(linkRefusedAsTaken(undefined)).toBe(false);
  });
});
