import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

/**
 * F3.6 / F3.7: a friend request by code is accepted, get_friends reflects it,
 * playing alongside a friend earns bonus XP, and recently-played lists the
 * co-player. Uses anon clients for the account RPCs and the superuser
 * connection to seed a completed match. */
it("befriends by code, earns the friend XP bonus, and lists recent players", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Friends integration tests only run against local Supabase.");

  const mk = () =>
    createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ada = mk();
  const bo = mk();
  const db = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await db.connect();

  const rpc = async (c: SupabaseClient, fn: string, args?: Record<string, unknown>) => {
    const { data, error } = await c.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };

  const userIds: string[] = [];
  const roomId = randomUUID();
  const matchId = randomUUID();

  try {
    const { data: a } = await ada.auth.signInAnonymously();
    const { data: b } = await bo.auth.signInAnonymously();
    const adaId = a.user!.id;
    const boId = b.user!.id;
    userIds.push(adaId, boId);
    await db.query(
      `update auth.users set is_anonymous = false,
         raw_user_meta_data = jsonb_build_object('display_name', case when id = $1 then 'Ada' else 'Bo' end)
       where id = any($2::uuid[])`,
      [adaId, [adaId, boId]],
    );

    // Bo shares a code; Ada requests; Bo accepts.
    const boCode = (await rpc(bo, "get_my_friend_code")) as string;
    expect(await rpc(ada, "send_friend_request", { p_code: boCode })).toBe("pending");
    await rpc(bo, "respond_friend_request", { p_friend: adaId, p_accept: true });

    const friends = (await rpc(ada, "get_friends")) as { userId: string; status: string }[];
    expect(friends).toContainEqual(
      expect.objectContaining({ userId: boId, status: "accepted" }),
    );

    // A completed game with the friend at the table earns the friend bonus.
    await db.query(
      `insert into public.rooms (id, code, game_type, status) values ($1, $2, 'ludo', 'summary')`,
      [roomId, `FR${Math.floor(Math.random() * 9000 + 1000)}`],
    );
    await db.query(
      `insert into public.matches (id, room_id, game_type, rules, ended_at, end_reason)
       values ($1, $2, 'ludo', '{"pawnsToWin":4}', now(), 'completed')`,
      [matchId, roomId],
    );
    await db.query(
      `insert into public.match_results
         (match_id, player_id, user_id, account_kind, ended_under_takeover, seat_index, color, placement, stats)
       values ($1, $2, $4, 'account', false, 0, 'red',  1, '{}'),
              ($1, $3, $5, 'account', false, 1, 'blue', 2, '{}')`,
      [matchId, randomUUID(), randomUUID(), adaId, boId],
    );
    await db.query("select private.award_match_xp($1)", [matchId]);

    const award = await db.query<{ xp: string; ff: string }>(
      "select xp, breakdown->>'friendFactor' as ff from public.xp_awards where match_id = $1 and user_id = $2",
      [matchId, adaId],
    );
    expect(award.rows[0].ff).toBe("1.25");
    // (50 base + 100 win) * 1.25 + 100 daily first win = 288.
    expect(Number(award.rows[0].xp)).toBe(288);

    const recent = (await rpc(ada, "get_recent_players")) as {
      userId: string;
      isFriend: boolean;
    }[];
    expect(recent).toContainEqual(expect.objectContaining({ userId: boId, isFriend: true }));
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
