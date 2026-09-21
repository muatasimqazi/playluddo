import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { Client } from "pg";
import { expect, it } from "vitest";
import { applySnakeMove, snakeMove } from "../../lib/board/snakes";
import type { GameRoomState } from "../../lib/board/types";

/** Isolated local-only clients. Never operates on an existing user's room. */
it.each(["ludo", "snakes_and_ladders"] as const)(
  "%s: two clients share board choice, rolls, chat and reconnect state",
  async (gameType) => {
    const env = parseEnv(readFileSync(".env.local", "utf8"));
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey)
      throw new Error(
        "Configure local Supabase in .env.local before running multiplayer tests.",
      );
    if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
      throw new Error(
        "Multiplayer integration tests only run against local Supabase.",
      );
    }
    const a = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const b = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userIds: string[] = [];
    let roomId: string | undefined;
    const channels: RealtimeChannel[] = [];

    async function rpc(
      client: typeof a,
      name: string,
      args: Record<string, unknown> = {},
    ) {
      const { data, error } = await client.rpc(name, args);
      if (error) throw new Error(`${name}: ${error.message}`);
      return data;
    }
    async function joined(channel: RealtimeChannel) {
      channels.push(channel);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Realtime subscription timed out")),
          12000,
        );
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
    }
    async function until(condition: () => boolean) {
      const deadline = Date.now() + 8000;
      while (!condition()) {
        if (Date.now() > deadline)
          throw new Error("Expected realtime message was not delivered");
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
    try {
      for (const client of [a, b]) {
        const { data, error } = await client.auth.signInAnonymously();
        if (error || !data.user)
          throw new Error(error?.message ?? "No test identity");
        userIds.push(data.user.id);
      }
      const room = await rpc(a, "create_room", {
        p_display_name: "Simulator QA host",
      });
      roomId = room.roomId;
      await rpc(b, "join_room", {
        p_code: room.code,
        p_display_name: "Simulator QA guest",
      });
      const host = await rpc(a, "claim_seat", { p_room_id: roomId });
      const guest = await rpc(b, "claim_seat", { p_room_id: roomId });
      const statesA: Record<string, unknown>[] = [],
        statesB: Record<string, unknown>[] = [];
      const chat: Record<string, unknown>[] = [];
      await joined(
        a
          .channel(`room:${roomId}`, { config: { private: true } })
          .on("broadcast", { event: "state_updated" }, ({ payload }) =>
            statesA.push(payload),
          ),
      );
      const guestChannel = b
        .channel(`room:${roomId}`, { config: { private: true } })
        .on("broadcast", { event: "state_updated" }, ({ payload }) =>
          statesB.push(payload),
        )
        .on("broadcast", { event: "table_message" }, ({ payload }) =>
          chat.push(payload),
        );
      await joined(guestChannel);
      const deniedFlip = await b.rpc("set_room_game", {
        p_room_id: roomId,
        p_game_type: gameType,
      });
      expect(deniedFlip.error?.message).toBe("NOT_HOST");
      await rpc(a, "set_room_game", {
        p_room_id: roomId,
        p_game_type: gameType,
      });
      if (gameType !== "ludo") {
        await until(
          () =>
            statesA.at(-1)?.gameType === gameType &&
            statesB.at(-1)?.gameType === gameType,
        );
      }
      await rpc(a, "start_match", { p_room_id: roomId });
      await until(
        () =>
          statesA.at(-1)?.status === "in_game" &&
          statesB.at(-1)?.status === "in_game",
      );
      expect(statesA.at(-1)).toEqual(statesB.at(-1));
      const before = (await rpc(a, "get_room_state", {
        p_room_id: roomId,
      })) as GameRoomState;
      const midGameFlip = await a.rpc("set_room_game", {
        p_room_id: roomId,
        p_game_type: "ludo",
      });
      expect(midGameFlip.error?.message).toBe("ALREADY_STARTED");
      const rejected = await b.rpc("request_roll", {
        p_room_id: roomId,
        p_connection_token: guest.connectionToken,
      });
      expect(rejected.error?.message).toBe("NOT_YOUR_TURN");
      const roll = await rpc(a, "request_roll", {
        p_room_id: roomId,
        p_connection_token: host.connectionToken,
      });
      await until(
        () =>
          Number(statesA.at(-1)?.eventSequence) > before.eventSequence &&
          Number(statesB.at(-1)?.eventSequence) > before.eventSequence,
      );
      expect(statesA.at(-1)).toEqual(statesB.at(-1));
      const { data: events, error } = await b
        .from("match_events")
        .select("event_type,payload")
        .eq("room_id", roomId)
        .eq("event_type", "dice_rolled");
      expect(error).toBeNull();
      expect(events?.at(-1)?.payload.dieValue).toBe(roll.dieValue);
      const message = await rpc(a, "send_table_message", {
        p_room_id: roomId,
        p_text: "Local simulator integration check",
        p_kind: "chat",
      });
      await until(() => chat.length === 1);
      expect(chat[0]).toEqual(message);
      expect(chat[0].playerId).toBe(host.playerId);
      await guestChannel.unsubscribe();
      const snapshot = await rpc(b, "get_room_state", { p_room_id: roomId });
      // Realtime attaches a transport id to broadcasts; it is not game state.
      expect(statesA.at(-1)).toMatchObject(snapshot);
      expect(snapshot.turnDeadlineAt).toBeTruthy();
      // start_match fills unoccupied seats with computers.
      expect(snapshot.gameType).toBe(gameType);
      expect(snapshot.pawns).toHaveLength(gameType === "ludo" ? 16 : 4);
      if (gameType === "snakes_and_ladders") {
        // The piece needs a six to leave the nest, so this first roll only
        // moves it about a sixth of the time — assert whichever the server
        // actually did rather than assuming a move happened.
        const move = snakeMove(before.pawns, "red", roll.dieValue);
        expect(snapshot.pawns).toEqual(
          move ? applySnakeMove(before.pawns, move) : before.pawns,
        );
        expect(snapshot.turnPlayerId).toBe(guest.playerId);
        expect(snapshot.turnPhase).toBe("awaiting_roll");
        const moves = await b
          .from("match_events")
          .select("payload")
          .eq("room_id", roomId)
          .eq("event_type", "legal_move_selected");
        expect(moves.error).toBeNull();
        expect(moves.data ?? []).toEqual(move ? [{ payload: move }] : []);
      }
    } finally {
      await Promise.all(channels.map((channel) => channel.unsubscribe()));
      await Promise.all([a.removeAllChannels(), b.removeAllChannels()]);
      a.realtime.disconnect();
      b.realtime.disconnect();
      if (roomId || userIds.length) {
        const db = new Client({
          connectionString:
            process.env.SUPABASE_DB_URL ??
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        });
        await db.connect();
        try {
          if (roomId)
            await db.query("delete from public.rooms where id=$1", [roomId]);
          if (userIds.length)
            await db.query("delete from auth.users where id=any($1::uuid[])", [
              userIds,
            ]);
        } finally {
          await db.end();
        }
      }
    }
  },
  45000,
);
