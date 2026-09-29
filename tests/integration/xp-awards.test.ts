import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";

/**
 * F3.2: award_match_xp grants XP from a completed match with the phase's
 * anti-farming rules, and never pays twice. Exercises the award function
 * directly through the superuser connection (it is private, fired by
 * finalize_match in production), which keeps the test off a full game drive.
 */
it("awards XP once per completed match, reduced against computers", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("XP integration tests only run against local Supabase.");

  const db = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await db.connect();

  const ada = randomUUID();
  const bo = randomUUID();
  const roomId = randomUUID();
  const humanMatch = randomUUID();
  const botMatch = randomUUID();

  try {
    await db.query(
      `insert into auth.users (id, aud, role, is_anonymous, raw_user_meta_data, created_at, updated_at)
       values ($1,'authenticated','authenticated',false,'{"display_name":"Ada"}',now(),now()),
              ($2,'authenticated','authenticated',false,'{"display_name":"Bo"}',now(),now())`,
      [ada, bo],
    );
    await db.query(
      `insert into public.rooms (id, code, game_type, status) values ($1, $2, 'ludo', 'summary')`,
      [roomId, `XP${Math.floor(Math.random() * 9000 + 1000)}`],
    );

    // A classic ludo game Ada wins against the human Bo.
    await db.query(
      `insert into public.matches (id, room_id, game_type, rules, ended_at, end_reason)
       values ($1, $2, 'ludo', '{"pawnsToWin":4,"startOnBoard":0}', now(), 'completed')`,
      [humanMatch, roomId],
    );
    await db.query(
      `insert into public.match_results
         (match_id, player_id, user_id, account_kind, ended_under_takeover, seat_index, color, placement, stats)
       values ($1, $2, $4, 'account', false, 0, 'red',  1, '{}'),
              ($1, $3, $5, 'account', false, 1, 'blue', 2, '{}')`,
      [humanMatch, randomUUID(), randomUUID(), ada, bo],
    );
    await db.query("select private.award_match_xp($1)", [humanMatch]);

    // Ada: base 50 + win 100 + daily first win 100 = 250. Bo: base 50.
    const first = await db.query<{ user_id: string; xp: string }>(
      "select user_id, xp from public.xp_awards where match_id = $1",
      [humanMatch],
    );
    const xpOf = (id: string) => Number(first.rows.find((r) => r.user_id === id)!.xp);
    expect(xpOf(ada)).toBe(250);
    expect(xpOf(bo)).toBe(50);

    // Idempotent: re-running changes nothing.
    await db.query("select private.award_match_xp($1)", [humanMatch]);
    const prog = await db.query<{ xp: string; level: number }>(
      "select xp, level from public.player_progression where user_id = $1",
      [ada],
    );
    expect(Number(prog.rows[0].xp)).toBe(250);
    expect(prog.rows[0].level).toBe(2); // 100 XP -> L2, 300 -> L3

    // A later game the same day against only a computer earns reduced credit
    // (0.25) and no second daily bonus.
    await db.query(
      `insert into public.matches (id, room_id, game_type, rules, ended_at, end_reason)
       values ($1, $2, 'ludo', '{"pawnsToWin":4,"startOnBoard":0}', now(), 'completed')`,
      [botMatch, roomId],
    );
    await db.query(
      `insert into public.match_results
         (match_id, player_id, user_id, account_kind, ended_under_takeover, seat_index, color, placement, stats)
       values ($1, $2, $3, 'account', false, 0, 'red',  1, '{}'),
              ($1, $4, null, 'bot',   false, 1, 'blue', 2, '{}')`,
      [botMatch, randomUUID(), ada, randomUUID()],
    );
    await db.query("select private.award_match_xp($1)", [botMatch]);
    const botAward = await db.query<{ xp: string }>(
      "select xp from public.xp_awards where match_id = $1 and user_id = $2",
      [botMatch, ada],
    );
    expect(Number(botAward.rows[0].xp)).toBe(38); // round((50 + 100) * 0.25)
  } finally {
    try {
      await db.query("delete from public.rooms where id = $1", [roomId]);
      await db.query("delete from auth.users where id = any($1::uuid[])", [[ada, bo]]);
    } finally {
      await db.end();
    }
  }
}, 45000);
