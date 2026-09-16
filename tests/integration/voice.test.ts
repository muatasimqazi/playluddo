import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { Client } from "pg";
import { expect, it } from "vitest";

/** Isolated local-only clients. Never operates on an existing user's room. */
it("voice roster and signaling: join/leave flip inVoice on state_updated, signals reach only the room, targets are validated", async () => {
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
      p_display_name: "Voice QA host",
    });
    roomId = room.roomId;
    await rpc(b, "join_room", {
      p_code: room.code,
      p_display_name: "Voice QA guest",
    });
    const host = await rpc(a, "claim_seat", { p_room_id: roomId });
    const guest = await rpc(b, "claim_seat", { p_room_id: roomId });

    const statesB: Record<string, unknown>[] = [];
    const signalsA: Record<string, unknown>[] = [];
    const signalsB: Record<string, unknown>[] = [];
    await joined(
      a
        .channel(`room:${roomId}`, { config: { private: true } })
        .on("broadcast", { event: "webrtc_signal" }, ({ payload }) =>
          signalsA.push(payload),
        ),
    );
    const guestChannel = b
      .channel(`room:${roomId}`, { config: { private: true } })
      .on("broadcast", { event: "state_updated" }, ({ payload }) =>
        statesB.push(payload),
      )
      .on("broadcast", { event: "webrtc_signal" }, ({ payload }) =>
        signalsB.push(payload),
      );
    await joined(guestChannel);

    // join_voice flips this seat's inVoice and rides the existing
    // state_updated broadcast — no separate roster channel needed.
    await rpc(a, "join_voice", { p_room_id: roomId });
    await until(
      () =>
        (statesB.at(-1)?.players as { id: string; inVoice: boolean }[] | undefined)?.find(
          (p) => p.id === host.playerId,
        )?.inVoice === true,
    );
    let players = statesB.at(-1)!.players as { id: string; inVoice: boolean }[];
    expect(players.find((p) => p.id === host.playerId)?.inVoice).toBe(true);
    expect(players.find((p) => p.id === guest.playerId)?.inVoice).toBe(false);

    // Signaling: every seated client receives the broadcast; the payload
    // carries `to` so recipients can tell it's (not) addressed to them.
    const fakeOffer = { type: "offer", sdp: "v=0 fake-sdp-for-test" };
    await rpc(a, "send_webrtc_signal", {
      p_room_id: roomId,
      p_to_player_id: guest.playerId,
      p_signal: fakeOffer,
    });
    await until(() => signalsB.length === 1 && signalsA.length === 1);
    // Realtime attaches a transport id to broadcasts; it is not signal data.
    expect(signalsB[0]).toMatchObject({
      from: host.playerId,
      to: guest.playerId,
      signal: fakeOffer,
    });
    expect(signalsA[0]).toEqual(signalsB[0]);

    // A target outside the room is rejected, not silently relayed.
    const rejected = await a.rpc("send_webrtc_signal", {
      p_room_id: roomId,
      p_to_player_id: "00000000-0000-0000-0000-000000000000",
      p_signal: fakeOffer,
    });
    expect(rejected.error?.message).toBe("INVALID_SIGNAL_TARGET");

    // leave_voice flips it back, again via state_updated.
    await rpc(a, "leave_voice", { p_room_id: roomId });
    await until(
      () =>
        (statesB.at(-1)?.players as { id: string; inVoice: boolean }[] | undefined)?.find(
          (p) => p.id === host.playerId,
        )?.inVoice === false,
    );
    players = statesB.at(-1)!.players as { id: string; inVoice: boolean }[];
    expect(players.find((p) => p.id === host.playerId)?.inVoice).toBe(false);
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
}, 45000);
