import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

async function profile(client: SupabaseClient, playerId?: string) {
  const { data, error } = await client.rpc(
    "get_player_profile",
    playerId ? { p_player_id: playerId } : {},
  );
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any;
}

/**
 * F3.1: get_player_profile aggregates an account's completed-match results and
 * respects the profile_hidden privacy flag when another player opens it from a
 * seat's avatar. Isolated local-only clients; seeds match_results directly
 * rather than driving two full games. */
it("a player's profile aggregates their results and hides stats when private", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Profile integration tests only run against local Supabase.");

  const ada = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bo = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const db = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await db.connect();

  const roomId = randomUUID();
  const ludoMatch = randomUUID();
  const snakesMatch = randomUUID();
  const boSeat = randomUUID();
  const userIds: string[] = [];

  try {
    const { data: adaAuth } = await ada.auth.signInAnonymously();
    const { data: boAuth } = await bo.auth.signInAnonymously();
    const adaId = adaAuth.user!.id;
    const boId = boAuth.user!.id;
    userIds.push(adaId, boId);

    // Turn the two anonymous sessions into real accounts (a guest has no
    // profile), and give Bo the privacy flag.
    await db.query(
      `update auth.users set is_anonymous = false,
         raw_user_meta_data = '{"display_name":"Ada","avatar_id":"fox"}' where id = $1`,
      [adaId],
    );
    await db.query(
      `update auth.users set is_anonymous = false,
         raw_user_meta_data = '{"display_name":"Bo","avatar_id":"owl","profile_hidden":true}'
         where id = $1`,
      [boId],
    );

    await db.query(
      `insert into public.rooms (id, code, game_type, status) values ($1, $2, 'ludo', 'summary')`,
      [roomId, `PF${Math.floor(Math.random() * 9000 + 1000)}`],
    );
    await db.query(
      `insert into public.matches (id, room_id, game_type, rules, ended_at, end_reason) values
        ($1, $3, 'ludo', '{}', now(), 'completed'),
        ($2, $3, 'snakes_and_ladders', '{}', now(), 'completed')`,
      [ludoMatch, snakesMatch, roomId],
    );
    // Ada wins the ludo game (drought of 7), Bo wins the snakes game.
    await db.query(
      `insert into public.match_results
         (match_id, player_id, user_id, account_kind, seat_index, color, placement, stats) values
        ($1, $3, $5, 'account', 0, 'red',  1, '{"capturesMade":3,"sixes":5,"longestRunWithoutSix":7}'),
        ($1, $4, $6, 'account', 1, 'blue', 2, '{"capturesMade":1,"sixes":2,"longestRunWithoutSix":3}'),
        ($2, $3, $5, 'account', 1, 'red',  2, '{"capturesMade":2,"sixes":4,"longestRunWithoutSix":9}'),
        ($2, $4, $6, 'account', 0, 'blue', 1, '{"capturesMade":0,"sixes":1,"longestRunWithoutSix":2}')`,
      [ludoMatch, snakesMatch, randomUUID(), randomUUID(), adaId, boId],
    );
    // A live seat for Bo, so Ada can open his profile from the table.
    await db.query(
      `insert into public.players (id, room_id, seat_index, user_id, display_name, color, is_bot)
        values ($1, $2, 1, $3, 'Bo', 'blue', false)`,
      [boSeat, roomId, boId],
    );

    const mine = await profile(ada);
    expect(mine.visibility).toBe("visible");
    expect(mine.gamesPlayed).toBe(2);
    expect(mine.wins).toBe(1);
    expect(mine.totalCaptures).toBe(5);
    expect(mine.totalSixes).toBe(9);
    expect(mine.favouriteColour).toBe("red");
    // The drought from a match she WON, not the longer one she lost.
    expect(mine.bestComeback).toBe(7);
    expect(mine.headToHead).toContainEqual(
      expect.objectContaining({ displayName: "Bo", games: 2, wins: 1 }),
    );
    expect(mine.winRateByMode).toContainEqual(
      expect.objectContaining({ mode: "ludo", games: 1, wins: 1 }),
    );

    // Bo keeps his stats private: Ada sees his name and avatar, no numbers.
    const bosProfile = await profile(ada, boSeat);
    expect(bosProfile.visibility).toBe("hidden");
    expect(bosProfile).not.toHaveProperty("gamesPlayed");

    // Bo sees his own full profile despite the flag.
    const bosOwn = await profile(bo);
    expect(bosOwn.visibility).toBe("visible");
    expect(bosOwn.wins).toBe(1);
  } finally {
    try {
      await db.query("delete from public.rooms where id = $1", [roomId]);
      if (userIds.length)
        await db.query("delete from auth.users where id = any($1::uuid[])", [userIds]);
    } finally {
      await db.end();
    }
  }
}, 45000);
