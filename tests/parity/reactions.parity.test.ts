import { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ALL_REACTIONS } from "../../lib/realtime/reactions";

/**
 * The reactions the picker offers (lib/realtime/reactions.ts) must be
 * exactly what the server accepts (private.allowed_reactions()), or a tap
 * would fail. Needs `supabase start`.
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

it("offers exactly the reactions the server accepts", async () => {
  const { rows } = await client.query("select private.allowed_reactions() as reactions");
  expect(rows[0].reactions).toEqual([...ALL_REACTIONS]);
});
