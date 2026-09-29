import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

/**
 * F4.4: watching is off by default; the host opens it; a 13+ non-seat can join,
 * read the table and react; any seated human closes it, evicting watchers. Uses
 * anon clients for the RPCs and the superuser connection to seat the host.
 */
it("opens watching, admits a watcher, and evicts on close", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Watch-tables integration tests only run against local Supabase.");

  const mk = () =>
    createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const host = mk();
  const wanda = mk();
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
  const hostSeat = randomUUID();

  try {
    const { data: h } = await host.auth.signInAnonymously();
    const { data: w } = await wanda.auth.signInAnonymously();
    const hostId = h.user!.id;
    const wandaId = w.user!.id;
    userIds.push(hostId, wandaId);
    await db.query(
      `update auth.users set raw_user_meta_data =
         jsonb_build_object('display_name', case when id = $1 then 'Host' else 'Wanda' end)
       where id = any($2::uuid[])`,
      [hostId, [hostId, wandaId]],
    );

    await db.query(
      `insert into public.rooms (id, code, game_type, status, max_players)
       values ($1, $2, 'ludo', 'in_game', 4)`,
      [roomId, `WT${Math.floor(Math.random() * 9000 + 1000)}`],
    );
    await db.query(
      `insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot)
       values ($1, $2, 0, $3, 'Host', 'red', 'connected', false)`,
      [hostSeat, roomId, hostId],
    );
    await db.query("update public.rooms set host_player_id = $1 where id = $2", [hostSeat, roomId]);

    // Off by default: a watcher can't join yet.
    await expect(rpc(wanda, "join_watch", { p_room_id: roomId, p_display_name: "Wanda" })).rejects.toThrow(
      /WATCHING_OFF/,
    );

    // A non-seated stranger can't open watching.
    await expect(rpc(wanda, "set_watching", { p_room_id: roomId, p_enabled: true })).rejects.toThrow(
      /SEAT_NOT_CONTROLLED/,
    );

    // The host opens it; Wanda joins and reads the table.
    await rpc(host, "set_watching", { p_room_id: roomId, p_enabled: true });
    const joined = (await rpc(wanda, "join_watch", {
      p_room_id: roomId,
      p_display_name: "Wanda",
    })) as { watchTopic: string };
    expect(joined.watchTopic).toMatch(/^watch:/);

    const view = (await rpc(wanda, "get_watch_state", { p_room_id: roomId })) as {
      watchingEnabled: boolean;
      watcherCount: number;
    };
    expect(view).toMatchObject({ watchingEnabled: true, watcherCount: 1 });

    // A watcher may read the event log (for animation) but nothing secret.
    const { error: evErr } = await wanda
      .from("match_events")
      .select("sequence")
      .eq("room_id", roomId);
    expect(evErr).toBeNull();

    // Any seated human closes it; the watcher is evicted.
    await rpc(host, "set_watching", { p_room_id: roomId, p_enabled: false });
    const left = await db.query("select count(*)::int as n from public.room_watchers where room_id = $1", [
      roomId,
    ]);
    expect(left.rows[0].n).toBe(0);
    await expect(rpc(wanda, "get_watch_state", { p_room_id: roomId })).rejects.toThrow(
      /ROOM_NOT_FOUND/,
    );
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
