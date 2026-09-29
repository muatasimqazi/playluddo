import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";

/**
 * F3.4: evaluate_achievements unlocks catalog entries from an account's
 * lifetime match_results, and only the mapped ones expose a Game Center id.
 * Driven through the xp_awards trigger, like production. */
it("unlocks achievements from match results and maps them to Game Center", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Achievement integration tests only run against local Supabase.");

  const db = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await db.connect();

  const ada = randomUUID();
  const bo = randomUUID();
  const roomId = randomUUID();
  const matchId = randomUUID();

  try {
    await db.query(
      `insert into auth.users (id, aud, role, is_anonymous, raw_user_meta_data, created_at, updated_at)
       values ($1,'authenticated','authenticated',false,'{}',now(),now()),
              ($2,'authenticated','authenticated',false,'{}',now(),now())`,
      [ada, bo],
    );
    await db.query(
      `insert into public.rooms (id, code, game_type, status) values ($1, $2, 'ludo', 'summary')`,
      [roomId, `AC${Math.floor(Math.random() * 9000 + 1000)}`],
    );
    await db.query(
      `insert into public.matches (id, room_id, game_type, rules, ended_at, end_reason)
       values ($1, $2, 'ludo', '{"pawnsToWin":4}', now(), 'completed')`,
      [matchId, roomId],
    );
    // Ada wins flawlessly, capturing three pawns and finishing all four.
    await db.query(
      `insert into public.match_results
         (match_id, player_id, user_id, account_kind, ended_under_takeover, seat_index, color, placement, stats)
       values ($1, $2, $4, 'account', false, 0, 'red',  1, '{"capturesMade":3,"pawnsLost":0,"pawnsFinished":4,"sixes":2}'),
              ($1, $3, $5, 'account', false, 1, 'blue', 2, '{"capturesMade":0,"pawnsLost":2}')`,
      [matchId, randomUUID(), randomUUID(), ada, bo],
    );
    await db.query("select private.award_match_xp($1)", [matchId]);

    const unlocked = await db.query<{ achievement_id: string }>(
      "select achievement_id from public.player_achievements where user_id = $1 order by achievement_id",
      [ada],
    );
    const ids = unlocked.rows.map((r) => r.achievement_id);
    expect(ids).toEqual(
      expect.arrayContaining(["first_win", "ludo_win", "flawless", "finisher", "triple"]),
    );
    // Not earned: won a two-player game (not full_house), didn't lose 3 pawns.
    expect(ids).not.toContain("full_house");
    expect(ids).not.toContain("survivor");

    // Only the mapped achievements carry a Game Center id.
    const gc = await db.query<{ gc: string }>(
      `select coalesce(jsonb_agg(a.gc_id), '[]'::jsonb)::text as gc
       from public.player_achievements pa
       join public.achievements a on a.id = pa.achievement_id
       where pa.user_id = $1 and a.gc_id is not null`,
      [ada],
    );
    expect(JSON.parse(gc.rows[0].gc)).toEqual(
      expect.arrayContaining(["com.luddohouse.first_win", "com.luddohouse.ludo_win"]),
    );
  } finally {
    try {
      await db.query("delete from public.rooms where id = $1", [roomId]);
      await db.query("delete from auth.users where id = any($1::uuid[])", [[ada, bo]]);
    } finally {
      await db.end();
    }
  }
}, 45000);
