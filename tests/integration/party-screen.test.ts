import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { Client } from "pg";
import { expect, it } from "vitest";
import { realtimeReady } from "./realtime";

/**
 * Party Mode, P1, P3, P4 and P5: a real screen client (no seat) receives its
 * room's live updates while a real phone joins and starts the game, reads
 * the event log it animates from, gets the reactions and piece previews
 * that phone sends from its controller, and sees the table wait for the
 * phone when it goes quiet and resume when it's back. Isolated
 * local-only clients; never touches an existing user's room.
 */
it("a party screen follows its room live without a seat", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Configure local Supabase in .env.local before running multiplayer tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Multiplayer integration tests only run against local Supabase.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const screen = createClient(url, anonKey, options);
  const phone = createClient(url, anonKey, options);
  const userIds: string[] = [];
  let roomId: string | undefined;
  const channels: RealtimeChannel[] = [];

  async function rpc(client: typeof screen, name: string, args?: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  }
  async function until(condition: () => boolean) {
    const deadline = Date.now() + 8000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("Expected realtime message was not delivered");
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  try {
    for (const client of [screen, phone]) {
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user) throw new Error(error?.message ?? "No test identity");
      userIds.push(data.user.id);
    }

    const party = await rpc(screen, "create_party_room", { p_game_type: "ludo" });
    roomId = party.roomId as string;

    const states: Record<string, unknown>[] = [];
    const messages: Record<string, unknown>[] = [];
    const previews: Record<string, unknown>[] = [];
    const channel = screen
      .channel(`room:${roomId}`, { config: { private: true } })
      .on("broadcast", { event: "state_updated" }, ({ payload }) => states.push(payload))
      .on("broadcast", { event: "table_message" }, ({ payload }) => messages.push(payload))
      .on("broadcast", { event: "move_preview" }, ({ payload }) => previews.push(payload));
    channels.push(channel);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 12000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(status));
        }
      });
    });

    // The phone sits down (becoming the VIP). The VIP flipping the board is
    // a harmless, repeatable broadcast that proves updates reach the screen.
    const seat = await rpc(phone, "join_room", { p_code: party.code, p_display_name: "Phone" });
    let game: "ludo" | "snakes_and_ladders" = "ludo";
    await realtimeReady(
      () => {
        game = game === "ludo" ? "snakes_and_ladders" : "ludo";
        return rpc(phone, "set_room_game", { p_room_id: roomId, p_game_type: game });
      },
      () => states.length > 0,
    );
    await rpc(phone, "set_room_game", { p_room_id: roomId, p_game_type: "ludo" });
    await until(() => states.at(-1)?.gameType === "ludo");

    const latest = states.at(-1)!;
    expect(latest.isParty).toBe(true);
    expect(latest.hostPlayerId).toBe(seat.playerId);
    expect((latest.players as { displayName: string }[]).map((p) => p.displayName)).toEqual(["Phone"]);

    // The screen itself can't take a seat.
    const sit = await screen.rpc("join_room", { p_code: party.code, p_display_name: "Screen" });
    expect(sit.error?.message).toBe("DISPLAY_CANNOT_SIT");

    // As the lobby's start button does for a lone player: add a computer, then start.
    await rpc(phone, "fill_bot", { p_room_id: roomId, p_seat_index: 1 });
    await rpc(phone, "start_match", { p_room_id: roomId });
    await until(() => states.at(-1)?.status === "in_game");
    expect(states.at(-1)).toMatchObject(await rpc(screen, "get_party_screen", { p_room_id: roomId }));

    // A reaction from the phone's controller shows on the screen; chat doesn't exist here.
    await rpc(phone, "send_table_message", { p_room_id: roomId, p_text: "🎉", p_kind: "reaction" });
    await until(() => messages.length > 0);
    expect(messages[0]).toMatchObject({ playerId: seat.playerId, text: "🎉", kind: "reaction" });

    // The screen reads the event log it animates rolls and moves from.
    const events = await screen.from("match_events").select("sequence, event_type").eq("room_id", roomId);
    expect(events.error).toBeNull();
    expect(events.data?.some((e) => e.event_type === "match_started")).toBe(true);

    // The phone rolled a six (set directly, since dice are random): picking a
    // piece shows on the screen before the move is confirmed.
    const admin = new Client({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await admin.connect();
    let pawnId: string;
    try {
      await admin.query(
        "update public.rooms set turn_player_id=$2, turn_phase='awaiting_move', active_dice_value=6 where id=$1",
        [roomId, seat.playerId],
      );
      pawnId = (await admin.query("select id from public.pawns where player_id=$1 order by pawn_index limit 1", [seat.playerId]))
        .rows[0].id;
    } finally {
      await admin.end();
    }
    await rpc(phone, "party_preview_move", { p_room_id: roomId, p_pawn_id: pawnId });
    await until(() => previews.length > 0);
    expect(previews[0]).toMatchObject({ playerId: seat.playerId, pawnId });

    // The phone goes quiet on its turn: the table waits for it, and the
    // screen says so. Its next heartbeat picks the game back up.
    const sweeper = new Client({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await sweeper.connect();
    try {
      await sweeper.query(
        "update public.rooms set turn_phase='awaiting_roll', active_dice_value=null, turn_deadline_at=now()-interval '1 second' where id=$1",
        [roomId],
      );
      await sweeper.query("update public.players set last_seen_at=now()-interval '40 seconds' where id=$1", [seat.playerId]);
      await sweeper.query("select public.sweep_expired_turns()");
    } finally {
      await sweeper.end();
    }
    await until(() => states.at(-1)?.pausedForPlayerId === seat.playerId);
    expect(states.at(-1)?.paused).toBe(true);
    await rpc(phone, "party_heartbeat", { p_room_id: roomId });
    await until(() => states.at(-1)?.paused === false);
    expect(states.at(-1)?.pausedForPlayerId).toBeNull();
  } finally {
    await Promise.all(channels.map((c) => c.unsubscribe()));
    await Promise.all([screen.removeAllChannels(), phone.removeAllChannels()]);
    screen.realtime.disconnect();
    phone.realtime.disconnect();
    if (roomId || userIds.length) {
      const db = new Client({
        connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      });
      await db.connect();
      try {
        if (roomId) await db.query("delete from public.rooms where id=$1", [roomId]);
        if (userIds.length) await db.query("delete from auth.users where id=any($1::uuid[])", [userIds]);
      } finally {
        await db.end();
      }
    }
  }
}, 60_000);
