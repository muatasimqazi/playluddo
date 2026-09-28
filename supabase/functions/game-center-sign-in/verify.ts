// @peculiar/x509 needs the Reflect metadata polyfill loaded before it.
import "reflect-metadata";
import { X509Certificate, cryptoProvider } from "@peculiar/x509";

cryptoProvider.set(crypto);

/**
 * The identity proof GameKit hands the app
 * (GKLocalPlayer.fetchItems(forIdentityVerificationSignature:)), sent on to
 * this function as JSON.
 */
export interface GameCenterProof {
  publicKeyUrl: string;
  /** base64 */
  signature: string;
  /** base64 */
  salt: string;
  /** Milliseconds since the epoch, when Apple signed the proof. */
  timestamp: number;
  teamPlayerId: string;
  bundleId: string;
}

export class ProofError extends Error {}

// A proof is only good for a few minutes, so a leaked one can't be replayed
// later. A little future slack covers device clock drift.
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_FUTURE_MS = 60 * 1000;

export type FetchCertificate = (url: string) => Promise<ArrayBuffer>;

const certificates = new Map<string, ArrayBuffer>();

/** Apple rotates the key rarely; keep each one for the life of the worker. */
export const fetchAppleCertificate: FetchCertificate = async (url) => {
  const cached = certificates.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new ProofError(`Could not fetch Apple's public key (${response.status})`);
  const der = await response.arrayBuffer();
  certificates.set(url, der);
  return der;
};

function fromBase64(value: string) {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new ProofError("Malformed proof");
  }
}

/**
 * What Apple signs: teamPlayerID and bundle ID (UTF-8), the timestamp as a
 * big-endian UInt64, then the salt.
 */
export function signedPayload(proof: GameCenterProof, salt: Uint8Array) {
  const text = new TextEncoder().encode(proof.teamPlayerId + proof.bundleId);
  const payload = new Uint8Array(text.length + 8 + salt.length);
  payload.set(text);
  new DataView(payload.buffer).setBigUint64(text.length, BigInt(proof.timestamp));
  payload.set(salt, text.length + 8);
  return payload;
}

/**
 * Checks the proof really came from Apple for this player and this app, and
 * returns the verified team player ID. Throws ProofError otherwise.
 *
 * Trust in the key comes from fetching it over HTTPS from an apple.com host,
 * as Apple's documentation describes.
 */
export async function verifyGameCenterProof(
  proof: GameCenterProof,
  {
    bundleId,
    now = Date.now(),
    fetchCertificate = fetchAppleCertificate,
  }: { bundleId: string; now?: number; fetchCertificate?: FetchCertificate },
): Promise<string> {
  const { publicKeyUrl, signature, salt, timestamp, teamPlayerId } = proof ?? {};
  if (
    typeof publicKeyUrl !== "string" ||
    typeof signature !== "string" ||
    typeof salt !== "string" ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    typeof teamPlayerId !== "string" ||
    !teamPlayerId
  ) {
    throw new ProofError("Malformed proof");
  }
  if (proof.bundleId !== bundleId) throw new ProofError("Proof is for a different app");

  let url: URL;
  try {
    url = new URL(publicKeyUrl);
  } catch {
    throw new ProofError("Malformed public key URL");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".apple.com")) {
    throw new ProofError("Public key is not hosted by Apple");
  }

  if (timestamp < now - MAX_AGE_MS || timestamp > now + MAX_FUTURE_MS) {
    throw new ProofError("Proof has expired");
  }

  const certificate = new X509Certificate(await fetchCertificate(url.href));
  const signedAt = new Date(now);
  if (signedAt < certificate.notBefore || signedAt > certificate.notAfter) {
    throw new ProofError("Apple's certificate is not valid");
  }
  const key = await certificate.publicKey.export(
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    fromBase64(signature),
    signedPayload(proof, fromBase64(salt)),
  );
  if (!valid) throw new ProofError("Signature does not match");
  return teamPlayerId;
}
