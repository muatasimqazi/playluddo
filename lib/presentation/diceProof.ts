/**
 * The browser's copy of dice protocol luddo-dice-v1
 * (supabase/migrations/20260928070000_verifiable_dice.sql, which has the
 * full description). tests/parity checks diceFace against the server's
 * private.dice_face with fixed inputs.
 *
 * What a passing check shows: every recorded roll follows from a seed that
 * was fixed, and fingerprinted, before the first roll, so no roll was
 * changed during or after play. It does not show how the seed was chosen.
 */

export const DICE_PROTOCOL = "luddo-dice-v1";

export interface DiceProof {
  protocol: string;
  matchId: string;
  /** hex(SHA-256(seed)), published before the first roll. */
  commitment: string;
  /** Hex, revealed once the match has ended; null until then. */
  seed: string | null;
  /** The match's recorded rolls, in order: roll k is index k. */
  rolls: { sequence: number; playerId: string | null; dieValue: number }[];
}

export type DiceCheck =
  | { ok: true; rolls: number }
  | {
      ok: false;
      reason: "no-seed" | "protocol" | "commitment" | "remembered" | "roll";
      /** For "roll": the first roll that doesn't match (0-based). */
      rollIndex?: number;
    };

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(seed: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey("raw", seed, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function faceFromKey(key: CryptoKey, matchId: string, index: number) {
  for (let block = 0; ; block++) {
    const message = new TextEncoder().encode(`${DICE_PROTOCOL}:${matchId}:${index}:${block}`);
    const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
    // The unbiased mapping: bytes 252-255 are skipped.
    for (const byte of hash) if (byte < 252) return 1 + (byte % 6);
  }
}

/** The face for roll `index` of a match, from its seed. */
export async function diceFace(seed: Uint8Array<ArrayBuffer>, matchId: string, index: number) {
  return faceFromKey(await hmacKey(seed), matchId, index);
}

export async function commitmentOf(seed: Uint8Array<ArrayBuffer>) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", seed));
}

/**
 * Checks a proof. `remembered` is the commitment this device saw before
 * play, if it saw one; without it, the check can only use the commitment the
 * server reports now.
 */
export async function verifyDiceProof(proof: DiceProof, remembered?: string | null): Promise<DiceCheck> {
  if (proof.protocol !== DICE_PROTOCOL) return { ok: false, reason: "protocol" };
  if (!proof.seed || !/^[0-9a-f]{64}$/.test(proof.seed)) return { ok: false, reason: "no-seed" };
  const seed = hexToBytes(proof.seed);
  const commitment = await commitmentOf(seed);
  if (commitment !== proof.commitment) return { ok: false, reason: "commitment" };
  if (remembered && remembered !== commitment) return { ok: false, reason: "remembered" };
  const key = await hmacKey(seed);
  for (let index = 0; index < proof.rolls.length; index++) {
    if ((await faceFromKey(key, proof.matchId, index)) !== proof.rolls[index].dieValue)
      return { ok: false, reason: "roll", rollIndex: index };
  }
  return { ok: true, rolls: proof.rolls.length };
}

// Commitments this device saw before play, keyed by match, newest last.
// Kept to the last 30 matches; losing one only weakens that one check.
const COMMITMENTS_KEY = "luddo-dice-commitments";
const KEEP = 30;

function readCommitments(): [string, string][] {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMMITMENTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** First sighting wins: a commitment that changes later is exactly what the check should catch. */
export function rememberCommitment(matchId: string, commitment: string) {
  const entries = readCommitments();
  if (entries.some(([id]) => id === matchId)) return;
  try {
    localStorage.setItem(COMMITMENTS_KEY, JSON.stringify([...entries, [matchId, commitment]].slice(-KEEP)));
  } catch {
    // Storage unavailable: the check falls back to the server's commitment.
  }
}

export function rememberedCommitment(matchId: string) {
  return readCommitments().find(([id]) => id === matchId)?.[1] ?? null;
}
