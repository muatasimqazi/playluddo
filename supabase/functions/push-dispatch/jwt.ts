/**
 * Small JOSE helpers on WebCrypto: base64url, PEM keys, and compact JWTs
 * signed with ES256 (APNs, VAPID) or RS256 (Google's OAuth for FCM).
 */

/** Bytes backed by a plain ArrayBuffer, which is what WebCrypto accepts. */
export type Bytes = Uint8Array<ArrayBuffer>;

export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Bytes {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The DER bytes inside a PEM block ("-----BEGIN PRIVATE KEY-----" …). */
export function pemToDer(pem: string): Bytes {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END)[^-]+-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

export function importEs256PrivateKey(pkcs8Pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pkcs8Pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export function importRs256PrivateKey(pkcs8Pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pkcs8Pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * A compact JWT. ECDSA signatures from WebCrypto are already the raw r||s
 * form JWS wants, so no DER unwrapping is needed.
 */
export async function signJwt(
  alg: "ES256" | "RS256",
  key: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const signingInput = `${base64UrlEncode(JSON.stringify({ alg, typ: "JWT", ...header }))}.${
    base64UrlEncode(JSON.stringify(claims))
  }`;
  const algorithm = alg === "ES256"
    ? { name: "ECDSA", hash: "SHA-256" }
    : { name: "RSASSA-PKCS1-v1_5" };
  const signature = new Uint8Array(
    await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}
