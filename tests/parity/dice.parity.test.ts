import { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { commitmentOf, diceFace } from "../../lib/presentation/diceProof";

/**
 * Dice protocol luddo-dice-v1: the browser's copy
 * (lib/presentation/diceProof.ts) must derive exactly the faces the server
 * rolls (private.dice_face in
 * supabase/migrations/20260928070000_verifiable_dice.sql), or honest
 * matches would fail their check. Needs `supabase start`.
 */

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: DB_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

const seeds = ["ab".repeat(32), "00".repeat(32), "0123456789abcdef".repeat(4)];
const matchId = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";

function bytes(hex: string) {
  return Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));
}

it("derives the same face as the server for every seed and index", async () => {
  for (const seed of seeds) {
    const { rows } = await client.query(
      "select array_agg(private.dice_face(decode($1, 'hex'), $2::uuid, k) order by k) as faces from generate_series(0, 99) k",
      [seed, matchId],
    );
    const browser = await Promise.all(
      Array.from({ length: 100 }, (_, k) => diceFace(bytes(seed), matchId, k)),
    );
    expect(browser).toEqual(rows[0].faces);
  }
});

it("computes the same commitment as the server", async () => {
  for (const seed of seeds) {
    const { rows } = await client.query(
      "select encode(extensions.digest(decode($1, 'hex'), 'sha256'), 'hex') as commitment",
      [seed],
    );
    expect(await commitmentOf(bytes(seed))).toBe(rows[0].commitment);
  }
});
