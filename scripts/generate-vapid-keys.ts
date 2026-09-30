/**
 * Makes a VAPID key pair for Web Push (docs/COMPETITIVE_ROADMAP.md F1.7).
 *
 *   npx tsx scripts/generate-vapid-keys.ts
 *
 * The public key goes to the web app as NEXT_PUBLIC_VAPID_PUBLIC_KEY (it's
 * the applicationServerKey browsers subscribe with, safe to expose) and to
 * the push-dispatch function as VAPID_PUBLIC_KEY; the private key only ever
 * goes to the function, as VAPID_PRIVATE_KEY. Changing the pair later means
 * every web subscriber has to turn notifications on again.
 */
const toBase64Url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function main() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
  const { d } = await crypto.subtle.exportKey("jwk", keys.privateKey);

  console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${d}`);
  console.log("VAPID_SUBJECT=mailto:<a support address>");
}

void main();
