import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { Client } from "pg";
import { expect, it } from "vitest";
import { realtimeReady } from "./realtime";

/**
 * Party Mode, P1 and P3–P8: a real screen client (no seat) receives its room's
 * live updates while a real phone joins and starts the game, reads the
 * event log it animates from, gets the reactions and piece previews that
 * phone sends from its controller, and sees the table wait for the phone
 * when it goes quiet and resume when it's back. A real audience phone
 * joins mid-game, follows the table live and cheers on the screen, and a
 * player who joined from elsewhere sets up a call the living room never
 * sees. Isolated
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
  const fan = createClient(url, anonKey, options);
  const away = createClient(url, anonKey, options);
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
    for (const client of [screen, phone, fan, away]) {
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user) throw new Error(error?.message ?? "No test identity");
      userIds.push(data.user.id);
    }

    const party = await rpc(screen, "create_party_room", { p_game_type: "ludo" });
    roomId = party.roomId as string;

    const states: Record<string, unknown>[] = [];
    const messages: Record<string, unknown>[] = [];
    const previews: Record<string, unknown>[] = [];
    const cheers: Record<string, unknown>[] = [];
    const channel = screen
      .channel(`room:${roomId}`, { config: { private: true } })
      .on("broadcast", { event: "state_updated" }, ({ payload }) => states.push(payload))
      .on("broadcast", { event: "table_message" }, ({ payload }) => messages.push(payload))
      .on("broadcast", { event: "move_preview" }, ({ payload }) => previews.push(payload))
      .on("broadcast", { event: "audience_reaction" }, ({ payload }) => cheers.push(payload));
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
    // Mixed rooms (P8): a second player joins from elsewhere and takes a
    // call. Their signals reach their own channel and not the screen's.
    const awaySeat = await rpc(away, "join_room", { p_code: party.code, p_display_name: "Away" });
    await rpc(away, "set_party_remote", { p_room_id: roomId, p_remote: true });
    const roomSignals: Record<string, unknown>[] = [];
    channel.on("broadcast", { event: "webrtc_signal" }, ({ payload }) => roomSignals.push(payload));
    const mySignals: Record<string, unknown>[] = [];
    const awayChannel = away
      .channel(`player:${awaySeat.playerId}`, { config: { private: true } })
      .on("broadcast", { event: "webrtc_signal" }, ({ payload }) => mySignals.push(payload));
    channels.push(awayChannel);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Call channel timed out")), 12000);
      awayChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(status));
        }
      });
    });
    // The living-room phone is not in the call, so it cannot signal at all.
    const blocked = await phone.rpc("send_webrtc_signal", {
      p_room_id: roomId,
      p_to_player_id: awaySeat.playerId,
      p_signal: { type: "offer" },
    });
    expect(blocked.error?.message).toBe("PARTY_ROOM");
    await realtimeReady(
      () => rpc(away, "send_webrtc_signal", { p_room_id: roomId, p_to_player_id: awaySeat.playerId, p_signal: { type: "offer" } }),
      () => mySignals.length > 0,
    );
    expect(mySignals[0]).toMatchObject({ from: awaySeat.playerId, to: awaySeat.playerId });
    expect(roomSignals).toEqual([]);
    await rpc(away, "set_party_remote", { p_room_id: roomId, p_remote: false });

    // Seat 1 is taken by the player from elsewhere, so the computer takes 2.
    await rpc(phone, "fill_bot", { p_room_id: roomId, p_seat_index: 2 });
    await rpc(phone, "start_match", { p_room_id: roomId });
    await until(() => states.at(-1)?.status === "in_game");
    expect(states.at(-1)).toMatchObject(await rpc(screen, "get_party_screen", { p_room_id: roomId }));

    // P7: the screen may lock seats, but the phone cannot manage the lock.
    expect((await phone.rpc("set_party_locked", { p_room_id: roomId, p_locked: true })).error?.message).toBe("ROOM_NOT_FOUND");
    await rpc(screen, "set_party_locked", { p_room_id: roomId, p_locked: true });
    await until(() => states.at(-1)?.partyLocked === true);
    expect(states.at(-1)?.partyTurnSeconds).toBe(30);

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
        "update public.rooms set turn_player_id=$2, turn_phase='awaiting_roll', active_dice_value=null, turn_deadline_at=now()-interval '1 second' where id=$1",
        [roomId, seat.playerId],
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

    // A late arrival joins the audience mid-game and follows the table live.
    await rpc(fan, "join_party_audience", { p_room_id: roomId, p_display_name: "Fan" });
    const fanExtras = await rpc(fan, "get_party_extras", { p_room_id: roomId });
    const fanStates: Record<string, unknown>[] = [];
    let removed = false;
    const fanChannel = fan
      .channel(fanExtras.audienceTopic, { config: { private: true } })
      .on("broadcast", { event: "audience_removed" }, () => { removed = true; })
      .on("broadcast", { event: "state_updated" }, ({ payload }) => fanStates.push(payload));
    channels.push(fanChannel);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Audience subscription timed out")), 12000);
      fanChannel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(status));
        }
      });
    });
    let autoRoll = false;
    await realtimeReady(
      () => {
        autoRoll = !autoRoll;
        return rpc(phone, "toggle_auto_roll", { p_room_id: roomId, p_enabled: autoRoll });
      },
      () => fanStates.length > 0,
    );
    expect(fanStates.at(-1)?.roomId).toBe(roomId);
    expect((await rpc(fan, "get_audience_state", { p_room_id: roomId })).status).toBe("in_game");

    // Their reaction shows on the screen with their name.
    await rpc(fan, "audience_react", { p_room_id: roomId, p_text: "👏" });
    await until(() => cheers.length > 0);
    expect(cheers[0]).toMatchObject({ name: "Fan", text: "👏" });

    // The between-game round (P8): the screen opens it as the podium goes
    // up, and a phone's answer reaches the screen live.
    const ended = new Client({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await ended.connect();
    try {
      await ended.query(
        "update public.rooms set status='summary', turn_phase='complete', turn_player_id=null, turn_deadline_at=null, winner_ids=array[$2::uuid] where id=$1",
        [roomId, seat.playerId],
      );
    } finally {
      await ended.end();
    }
    await rpc(screen, "open_party_round", { p_room_id: roomId });
    const opened = await rpc(screen, "get_party_extras", { p_room_id: roomId });
    expect(opened.round.question).toBeTruthy();
    expect(opened.round.answer).toBeNull();
    const before = messages.length;
    await rpc(fan, "guess_party_round", { p_room_id: roomId, p_guess: 12 });
    const answered = await rpc(fan, "get_party_extras", { p_room_id: roomId });
    expect(answered.round.myGuess).toBe(12);
    expect(answered.round.guessCount).toBe(1);
    expect(messages.length).toBe(before);
    // Back to a running game for the rest of the checks.
    const resume = new Client({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await resume.connect();
    try {
      await resume.query("update public.rooms set status='in_game', winner_ids='{}' where id=$1", [roomId]);
    } finally {
      await resume.end();
    }

    await rpc(fan, "report_player", { p_room_id: roomId, p_player_id: seat.playerId, p_reason: "other" });
    const memberId = fanExtras.audienceMembers.find((m: { isMe: boolean }) => m.isMe).id;
    await rpc(phone, "report_party_audience", { p_room_id: roomId, p_member_id: memberId, p_reason: "other" });
    await rpc(phone, "remove_party_audience", { p_room_id: roomId, p_member_id: memberId });
    await until(() => removed);
    const afterRemoval = fanStates.length;
    // Keep the removed socket open. Repeated delivered screen updates must
    // no longer be sent to that membership, even with cached authorization.
    for (let n = 0; n < 3; n++) {
      const before = states.length;
      await rpc(screen, "set_party_locked", { p_room_id: roomId, p_locked: n % 2 === 0 });
      await until(() => states.length > before);
    }
    expect(fanStates.length).toBe(afterRemoval);
    expect((await fan.rpc("get_audience_state", { p_room_id: roomId })).error?.message).toBe("NOT_AUDIENCE");
    expect((await fan.rpc("join_party_audience", { p_room_id: roomId, p_display_name: "Back" })).error?.message).toBe("PARTY_REMOVED");
  } finally {
    await Promise.all(channels.map((c) => c.unsubscribe()));
    await Promise.all([
      screen.removeAllChannels(),
      phone.removeAllChannels(),
      fan.removeAllChannels(),
      away.removeAllChannels(),
    ]);
    screen.realtime.disconnect();
    phone.realtime.disconnect();
    fan.realtime.disconnect();
    away.realtime.disconnect();
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
