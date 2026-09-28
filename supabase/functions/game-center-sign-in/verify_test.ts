// cd supabase/functions/game-center-sign-in && deno test --allow-net
import "reflect-metadata";
import { assertEquals, assertRejects } from "@std/assert";
import { X509CertificateGenerator } from "@peculiar/x509";
import { type GameCenterProof, ProofError, signedPayload, verifyGameCenterProof } from "./verify.ts";

const BUNDLE_ID = "com.luddohouse.app";
const NOW = Date.UTC(2026, 8, 28, 12);
const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };

// A self-signed stand-in for Apple's key.
const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
const certificate = await X509CertificateGenerator.createSelfSigned({
  serialNumber: "01",
  name: "CN=Test Game Center",
  notBefore: new Date(NOW - 86_400_000),
  notAfter: new Date(NOW + 86_400_000),
  signingAlgorithm: algorithm,
  keys,
});
const der = certificate.rawData;
const fetchCertificate = () => Promise.resolve(der);

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function proof(overrides: Partial<GameCenterProof> = {}): Promise<GameCenterProof> {
  const salt = crypto.getRandomValues(new Uint8Array(8));
  const unsigned = {
    publicKeyUrl: "https://static.gc.apple.com/public-key/gc-prod-12.cer",
    signature: "",
    salt: toBase64(salt),
    timestamp: NOW - 5_000,
    teamPlayerId: "T:_abc123",
    bundleId: BUNDLE_ID,
    ...overrides,
  };
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, signedPayload(unsigned, salt)),
  );
  return { ...unsigned, signature: toBase64(signature) };
}

const verify = (value: GameCenterProof, now = NOW) =>
  verifyGameCenterProof(value, { bundleId: BUNDLE_ID, now, fetchCertificate });

Deno.test("accepts a proof signed by the key for this app", async () => {
  assertEquals(await verify(await proof()), "T:_abc123");
});

Deno.test("rejects a proof whose player ID was swapped after signing", async () => {
  const signed = await proof();
  await assertRejects(() => verify({ ...signed, teamPlayerId: "T:_someone-else" }), ProofError, "Signature");
});

Deno.test("rejects a proof for another app", async () => {
  await assertRejects(async () => verify(await proof({ bundleId: "com.example.other" })), ProofError, "different app");
});

Deno.test("rejects a key that isn't hosted on apple.com over HTTPS", async () => {
  for (const publicKeyUrl of [
    "https://static.gc.apple.com.evil.example/key.cer",
    "http://static.gc.apple.com/key.cer",
    "https://evil.example/apple.com/key.cer",
  ]) {
    await assertRejects(async () => verify(await proof({ publicKeyUrl })), ProofError, "Apple");
  }
});

Deno.test("rejects an old or far-future proof", async () => {
  await assertRejects(async () => verify(await proof({ timestamp: NOW - 11 * 60_000 })), ProofError, "expired");
  await assertRejects(async () => verify(await proof({ timestamp: NOW + 5 * 60_000 })), ProofError, "expired");
});

Deno.test("rejects malformed input", async () => {
  await assertRejects(() => verify({} as GameCenterProof), ProofError, "Malformed");
  const signed = await proof();
  await assertRejects(() => verify({ ...signed, signature: "%%%" }), ProofError, "Malformed");
});
