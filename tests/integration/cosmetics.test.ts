import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

/**
 * F3.5: cosmetics unlock from the account's level/achievements/streak, and
 * equip_cosmetic only accepts owned items. Uses the anon client for the RPCs
 * (so auth.uid() is real) and the superuser connection to seed progression. */
it("unlocks cosmetics by level and equips only owned ones", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Cosmetics integration tests only run against local Supabase.");

  const ada = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await db.connect();
  let userId: string | undefined;

  try {
    const { data } = await ada.auth.signInAnonymously();
    userId = data.user!.id;
    // A real level-5 account.
    await db.query("update auth.users set is_anonymous = false where id = $1", [userId]);
    await db.query(
      "insert into public.player_progression (user_id, xp, level) values ($1, 700, 5)",
      [userId],
    );
    await db.query("select private.evaluate_cosmetics($1)", [userId]);

    const { data: cosmetics, error } = await ada.rpc("get_my_cosmetics");
    if (error) throw new Error(error.message);
    const byId = Object.fromEntries(
      (cosmetics as { id: string; owned: boolean }[]).map((c) => [c.id, c]),
    );
    // Defaults are always owned; level unlocks up to the account's level.
    expect(byId.board_signature.owned).toBe(true);
    expect(byId.board_classic.owned).toBe(true);
    // Every board is free.
    expect(byId.board_geometric.owned).toBe(true);
    expect(byId.board_aladdin.owned).toBe(true);
    expect(byId.dice_glass.owned).toBe(true); // level 2
    expect(byId.dice_wood.owned).toBe(false); // level 10

    // Equipping an owned cosmetic succeeds.
    const { error: equipErr } = await ada.rpc("equip_cosmetic", { p_cosmetic_id: "board_classic" });
    expect(equipErr).toBeNull();

    // Equipping a locked one is rejected.
    const { error: lockedErr } = await ada.rpc("equip_cosmetic", { p_cosmetic_id: "dice_wood" });
    expect(lockedErr?.message).toContain("COSMETIC_LOCKED");
  } finally {
    try {
      if (userId) await db.query("delete from auth.users where id = $1", [userId]);
    } finally {
      await db.end();
    }
  }
}, 45000);
