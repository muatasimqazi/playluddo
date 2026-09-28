/**
 * Sign in with Apple token revocation, which Apple requires when an account
 * created with Sign in with Apple is deleted: exchange a fresh authorization
 * code (the app asks Apple for one when the player confirms deletion) for a
 * refresh token, then revoke it. That removes Luddo House from the player's
 * "Apps Using Apple ID" list.
 *
 * https://developer.apple.com/documentation/sign_in_with_apple/revoke_tokens
 */
export interface AppleCredentials {
  teamId: string;
  keyId: string;
  /** Contents of the AuthKey_<keyId>.p8 file (PKCS#8 PEM). */
  privateKey: string;
  /** Whose code this is: the app's bundle ID for native iOS sign-in. */
  clientId: string;
}

const APPLE = "https://appleid.apple.com";

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

function pemBody(pem: string) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

/** The ES256 client secret Apple's token endpoints expect (valid 5 minutes). */
export async function appleClientSecret(
  { teamId, keyId, privateKey, clientId }: AppleCredentials,
  now = Date.now(),
) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBody(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const issuedAt = Math.floor(now / 1000);
  const unsigned = `${encodeJson({ alg: "ES256", kid: keyId })}.${encodeJson({
    iss: teamId,
    iat: issuedAt,
    exp: issuedAt + 300,
    aud: APPLE,
    sub: clientId,
  })}`;
  // WebCrypto's ECDSA signature is already the raw r||s form JWTs use.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

async function post(fetcher: typeof fetch, path: string, form: Record<string, string>) {
  const response = await fetcher(`${APPLE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  if (!response.ok) throw new Error(`Apple ${path} failed (${response.status}): ${await response.text()}`);
  return response;
}

/** Exchanges the authorization code and revokes the resulting token. */
export async function revokeAppleAuthorization(
  authorizationCode: string,
  credentials: AppleCredentials,
  fetcher: typeof fetch = fetch,
) {
  const clientSecret = await appleClientSecret(credentials);
  const tokens = await (
    await post(fetcher, "/auth/token", {
      client_id: credentials.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: "authorization_code",
    })
  ).json() as { refresh_token?: string; access_token?: string };
  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) throw new Error("Apple returned no token to revoke");
  await post(fetcher, "/auth/revoke", {
    client_id: credentials.clientId,
    client_secret: clientSecret,
    token,
    token_type_hint: tokens.refresh_token ? "refresh_token" : "access_token",
  });
}
