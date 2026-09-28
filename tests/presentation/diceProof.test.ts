import { afterEach, expect, it, vi } from "vitest";
import {
  commitmentOf,
  diceFace,
  DICE_PROTOCOL,
  rememberCommitment,
  rememberedCommitment,
  verifyDiceProof,
  type DiceProof,
} from "../../lib/presentation/diceProof";

const seedHex = "5a".repeat(32);
const seed = Uint8Array.from({ length: 32 }, () => 0x5a);
const matchId = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";

async function honestProof(rolls = 40): Promise<DiceProof> {
  const faces = await Promise.all(Array.from({ length: rolls }, (_, k) => diceFace(seed, matchId, k)));
  return {
    protocol: DICE_PROTOCOL,
    matchId,
    commitment: await commitmentOf(seed),
    seed: seedHex,
    rolls: faces.map((dieValue, k) => ({ sequence: 10 + k, playerId: "p", dieValue })),
  };
}

afterEach(() => vi.unstubAllGlobals());

it("passes an honest match", async () => {
  const proof = await honestProof();
  expect(await verifyDiceProof(proof, proof.commitment)).toEqual({ ok: true, rolls: 40 });
});

it("catches a roll that was changed, and says which", async () => {
  const proof = await honestProof();
  proof.rolls[17].dieValue = (proof.rolls[17].dieValue % 6) + 1;
  expect(await verifyDiceProof(proof)).toEqual({ ok: false, reason: "roll", rollIndex: 17 });
});

it("catches a roll that was removed", async () => {
  const proof = await honestProof();
  proof.rolls.splice(5, 1);
  const check = await verifyDiceProof(proof);
  // Removing one shifts every later roll onto the wrong index; unless the
  // next face happens to repeat, the first mismatch is at the removal.
  expect(check.ok).toBe(false);
});

it("catches a seed that doesn't match the commitment", async () => {
  const proof = await honestProof();
  proof.commitment = "0".repeat(64);
  expect(await verifyDiceProof(proof)).toEqual({ ok: false, reason: "commitment" });
});

it("catches a commitment that changed since this device first saw it", async () => {
  const proof = await honestProof();
  expect(await verifyDiceProof(proof, "f".repeat(64))).toEqual({ ok: false, reason: "remembered" });
});

it("can't check before the seed is revealed", async () => {
  const proof = { ...(await honestProof()), seed: null };
  expect(await verifyDiceProof(proof)).toEqual({ ok: false, reason: "no-seed" });
});

it("refuses a protocol it doesn't know", async () => {
  const proof = { ...(await honestProof()), protocol: "luddo-dice-v2" };
  expect(await verifyDiceProof(proof)).toEqual({ ok: false, reason: "protocol" });
});

it("remembers the first commitment it sees for a match", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  rememberCommitment("m1", "aaa");
  rememberCommitment("m1", "bbb");
  expect(rememberedCommitment("m1")).toBe("aaa");
  expect(rememberedCommitment("m2")).toBeNull();
});
