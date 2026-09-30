// cd supabase/functions/push-dispatch && deno test
import { assert, assertEquals, assertRejects } from "@std/assert";
import { base64UrlDecode, base64UrlEncode, type Bytes } from "./jwt.ts";
import { encryptPayload, vapidAuthorization } from "./webpush.ts";

const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8),
  );
}

/** What the browser does on receipt (RFC 8291 section 3, receiver side). */
async function browserDecrypt(message: Bytes, ua: CryptoKeyPair, authSecret: Bytes) {
  const salt = message.slice(0, 16);
  const recordSize = new DataView(message.buffer, message.byteOffset).getUint32(16);
  const idLength = message[20];
  const asPublic = message.slice(21, 21 + idLength);
  const ciphertext = message.slice(21 + idLength);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));

  const asKey = await crypto.subtle.importKey("raw", asPublic, ecdh, false, []);
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256),
  );
  const text = (s: string) => new TextEncoder().encode(s);
  const info = new Uint8Array([...text("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, secret, info, 32);
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  return { recordSize, idLength, padded };
}

async function subscriber() {
  const ua = await crypto.subtle.generateKey(ecdh, true, ["deriveBits"]);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)));
  return { ua, authSecret, subscription: { p256dh, auth: base64UrlEncode(authSecret) } };
}

Deno.test("a payload decrypts in the browser to the original, with the last-record delimiter", async () => {
  const { ua, authSecret, subscription } = await subscriber();
  const payload = JSON.stringify({ title: "Your turn", body: "Everyone's waiting on your roll.", url: "/room?id=x" });

  const message = await encryptPayload(subscription, new TextEncoder().encode(payload));
  const { recordSize, idLength, padded } = await browserDecrypt(message, ua, authSecret);

  assertEquals(recordSize, 4096);
  assertEquals(idLength, 65);
  assertEquals(padded[padded.length - 1], 2);
  assertEquals(new TextDecoder().decode(padded.slice(0, -1)), payload);
});

Deno.test("a message encrypted for one browser does not decrypt for another", async () => {
  const alice = await subscriber();
  const bob = await subscriber();
  const message = await encryptPayload(alice.subscription, new TextEncoder().encode("hi"));
  await assertRejects(() => browserDecrypt(message, bob.ua, bob.authSecret));
});

Deno.test("the VAPID header carries a valid ES256 token for the push service's origin", async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const vapid = { publicKey: base64UrlEncode(publicRaw), privateKey: jwk.d!, subject: "mailto:support@example.com" };
  const now = Date.UTC(2026, 8, 30, 12);

  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid, now);
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assertEquals(k, vapid.publicKey);

  const [h, c, s] = jwt.split(".");
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(c)));
  assertEquals(claims.aud, "https://fcm.googleapis.com");
  assertEquals(claims.sub, "mailto:support@example.com");
  assertEquals(claims.exp, now / 1000 + 12 * 3600);
  assert(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keys.publicKey,
      base64UrlDecode(s),
      new TextEncoder().encode(`${h}.${c}`),
    ),
  );
});

Deno.test("matches the RFC 8291 Appendix A test vector byte for byte", async () => {
  const asPublic = base64UrlDecode(
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  );
  const asPrivate = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      x: base64UrlEncode(asPublic.slice(1, 33)),
      y: base64UrlEncode(asPublic.slice(33, 65)),
    },
    ecdh,
    true,
    ["deriveBits"],
  );
  const asPublicKey = await crypto.subtle.importKey("raw", asPublic, ecdh, true, []);

  const message = await encryptPayload(
    {
      p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    },
    new TextEncoder().encode("When I grow up, I want to be a watermelon"),
    { publicKey: asPublicKey, privateKey: asPrivate },
    base64UrlDecode("DGv6ra1nlYgDCS1FRnbzlw"),
  );

  assertEquals(
    base64UrlEncode(message),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});
