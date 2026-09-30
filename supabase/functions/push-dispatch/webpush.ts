/**
 * Web Push on WebCrypto alone: message encryption (RFC 8291, aes128gcm
 * content coding from RFC 8188) and VAPID sender identification (RFC 8292).
 *
 * VAPID keys are a P-256 pair kept as base64url: the 65-byte uncompressed
 * public key (the same value the browser gets as applicationServerKey) and
 * the 32-byte private scalar. `scripts/generate-vapid-keys.ts` makes a pair.
 */
import { base64UrlDecode, base64UrlEncode, type Bytes, signJwt } from "./jwt.ts";

export interface WebPushSubscription {
  endpoint: string;
  /** The browser's p256dh key, base64url. */
  p256dh: string;
  /** The browser's auth secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** "mailto:…" or an https URL the push service can contact. */
  subject: string;
}

const RECORD_SIZE = 4096;

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

const text = (s: string) => new TextEncoder().encode(s);

/**
 * Encrypts `plaintext` for one subscription. `senderKeys` and `salt` are only
 * passed by tests; normally both are fresh for every message.
 */
export async function encryptPayload(
  subscription: Pick<WebPushSubscription, "p256dh" | "auth">,
  plaintext: Bytes,
  senderKeys?: CryptoKeyPair,
  salt: Bytes = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Bytes> {
  const uaPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);

  const keys = senderKeys ??
    await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, keys.privateKey, 256),
  );

  // RFC 8291 section 3.4.
  const ikm = await hkdf(
    authSecret,
    ecdhSecret,
    concat(text("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);

  // One record: the payload, then the 0x02 "last record" delimiter.
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error("Web Push payload too large");
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      concat(plaintext, new Uint8Array([2])),
    ),
  );

  // RFC 8188 header: salt, record size, key id (the sender's public key).
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export async function vapidAuthorization(endpoint: string, vapid: VapidKeys, now = Date.now()) {
  const publicKey = base64UrlDecode(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: base64UrlEncode(publicKey.slice(1, 33)),
      y: base64UrlEncode(publicKey.slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const jwt = await signJwt("ES256", key, {
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  });
  return `vapid t=${jwt}, k=${vapid.publicKey}`;
}

export type SendResult = "ok" | "gone" | "error";

export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: unknown,
  vapid: VapidKeys,
  options: { ttlSeconds: number; topic?: string },
): Promise<SendResult> {
  const body = await encryptPayload(subscription, text(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(subscription.endpoint, vapid),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds),
    Urgency: "high",
  };
  // A newer message with the same topic replaces an undelivered older one.
  if (options.topic) headers.Topic = options.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

  const response = await fetch(subscription.endpoint, { method: "POST", headers, body });
  await response.body?.cancel();
  if (response.ok) return "ok";
  if (response.status === 404 || response.status === 410) return "gone";
  console.error("push-dispatch: web push failed", response.status);
  return "error";
}
