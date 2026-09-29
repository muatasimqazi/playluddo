import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";

/**
 * F3.3: touch_streak advances a day streak, spends earned freezes to bridge a
 * gap, and resets when a gap can't be covered. Freezes are granted at
 * milestones. Exercised directly through the superuser connection (the
 * function is private, fired by the xp_awards trigger in production). */
it("advances a day streak, bridges gaps with earned freezes, and resets", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Streak integration tests only run against local Supabase.");

  const db = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await db.connect();

  const user = randomUUID();
  const touch = (date: string) => db.query("select private.touch_streak($1, $2::date)", [user, date]);
  const read = async () => {
    const { rows } = await db.query<{
      current_streak: number;
      longest_streak: number;
      freezes: number;
    }>(
      "select current_streak, longest_streak, freezes from public.player_streaks where user_id = $1",
      [user],
    );
    return rows[0];
  };

  try {
    await db.query(
      `insert into auth.users (id, aud, role, is_anonymous, raw_user_meta_data, created_at, updated_at)
       values ($1,'authenticated','authenticated',false,'{}',now(),now())`,
      [user],
    );

    // Three consecutive days -> streak 3, and the 3-day milestone earns a freeze.
    await touch("2026-01-01");
    await touch("2026-01-02");
    await touch("2026-01-03");
    let s = await read();
    expect(s.current_streak).toBe(3);
    expect(s.freezes).toBe(1);

    // The same day again is a no-op.
    await touch("2026-01-03");
    expect((await read()).current_streak).toBe(3);

    // Missing one day spends the freeze to keep the streak alive.
    await touch("2026-01-05");
    s = await read();
    expect(s.current_streak).toBe(4);
    expect(s.freezes).toBe(0);

    // A gap with no freezes left breaks the streak; the longest is kept.
    await touch("2026-01-10");
    s = await read();
    expect(s.current_streak).toBe(1);
    expect(s.longest_streak).toBe(4);
  } finally {
    try {
      await db.query("delete from auth.users where id = $1", [user]);
    } finally {
      await db.end();
    }
  }
}, 45000);
