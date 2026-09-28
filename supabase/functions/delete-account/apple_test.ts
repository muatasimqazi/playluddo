// cd supabase/functions/delete-account && deno test
import { assertEquals, assertRejects } from "@std/assert";
import { appleClientSecret, revokeAppleAuthorization } from "./apple.ts";

const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
const privateKey = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
const credentials = { teamId: "TEAM123456", keyId: "KEY1234567", privateKey, clientId: "com.luddohouse.app" };

const fromBase64url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

Deno.test("client secret is an ES256 JWT for the app, signed with the key", async () => {
  const now = Date.UTC(2026, 8, 28);
  const [header, payload, signature] = (await appleClientSecret(credentials, now)).split(".");
  assertEquals(JSON.parse(new TextDecoder().decode(fromBase64url(header))), { alg: "ES256", kid: "KEY1234567" });
  assertEquals(JSON.parse(new TextDecoder().decode(fromBase64url(payload))), {
    iss: "TEAM123456",
    iat: now / 1000,
    exp: now / 1000 + 300,
    aud: "https://appleid.apple.com",
    sub: "com.luddohouse.app",
  });
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    keys.publicKey,
    fromBase64url(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  assertEquals(valid, true);
});

function fakeApple(responses: Record<string, Response>) {
  const calls: { path: string; form: URLSearchParams }[] = [];
  const fetcher = ((url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push({ path, form: init.body as URLSearchParams });
    return Promise.resolve(responses[path].clone());
  }) as typeof fetch;
  return { calls, fetcher };
}

Deno.test("exchanges the code, then revokes the refresh token", async () => {
  const { calls, fetcher } = fakeApple({
    "/auth/token": Response.json({ access_token: "a", refresh_token: "r" }),
    "/auth/revoke": new Response(null, { status: 200 }),
  });
  await revokeAppleAuthorization("code-1", credentials, fetcher);
  assertEquals(calls.map((call) => call.path), ["/auth/token", "/auth/revoke"]);
  assertEquals(calls[0].form.get("code"), "code-1");
  assertEquals(calls[0].form.get("grant_type"), "authorization_code");
  assertEquals(calls[1].form.get("token"), "r");
  assertEquals(calls[1].form.get("token_type_hint"), "refresh_token");
  assertEquals(calls[1].form.get("client_id"), "com.luddohouse.app");
});

Deno.test("reports an expired or reused code instead of pretending it revoked", async () => {
  const { fetcher } = fakeApple({
    "/auth/token": Response.json({ error: "invalid_grant" }, { status: 400 }),
  });
  await assertRejects(() => revokeAppleAuthorization("stale", credentials, fetcher), Error, "invalid_grant");
});
