import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { buildReplay, type MatchTranscript } from "../../lib/presentation/replay";

/**
 * F4.3: a participant can read a finished match's transcript and their own
 * history; a non-participant cannot; and the transcript reconstructs into a
 * captioned replay. Seeds a room, match and events via the superuser
 * connection, then calls the RPCs as the seated account.
 */
it("serves a match transcript and history to its participant, and rebuilds a replay", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Match-replay integration tests only run against local Supabase.");

  const mk = () =>
    createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ada = mk();
  const stranger = mk();
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
  const seatId = randomUUID();

  try {
    const { data: a } = await ada.auth.signInAnonymously();
    const { data: s } = await stranger.auth.signInAnonymously();
    const adaId = a.user!.id;
    userIds.push(adaId, s.user!.id);
    await db.query(
      `update auth.users set is_anonymous = false,
         raw_user_meta_data = '{"display_name":"Ada","avatar_id":"fox"}'
       where id = $1`,
      [adaId],
    );

    await db.query(
      `insert into public.rooms (id, code, game_type, status, current_match_id)
       values ($1, $2, 'ludo', 'summary', $3)`,
      [roomId, `RP${Math.floor(Math.random() * 9000 + 1000)}`, matchId],
    );
    await db.query(
      `insert into public.matches (id, room_id, game_type, rules, ended_at, end_reason)
       values ($1, $2, 'ludo', '{"pawnsToWin":4}', now(), 'completed')`,
      [matchId, roomId],
    );
    await db.query(
      `insert into public.players (id, room_id, seat_index, user_id, display_name, color, status, is_bot)
       values ($1, $2, 0, $3, 'Ada', 'red', 'connected', false)`,
      [seatId, roomId, adaId],
    );
    await db.query(
      `insert into public.match_results
         (match_id, player_id, user_id, account_kind, ended_under_takeover, seat_index, color, placement, stats)
       values ($1, $2, $3, 'account', false, 0, 'red', 1, '{}')`,
      [matchId, seatId, adaId],
    );
    await db.query(
      `insert into public.match_events (room_id, match_id, sequence, event_type, player_id, payload) values
        ($1, $2, 1, 'match_started', null, $3),
        ($1, $2, 2, 'dice_rolled', $4, '{"dieValue":6}'),
        ($1, $2, 3, 'legal_move_selected', $4, '{"pawnId":"red-0","toTileId":"track:red:0","capturesPawnIds":[],"finishesPawn":false}'),
        ($1, $2, 4, 'match_completed', $4, '{"winnerId":"${seatId}"}')`,
      [
        roomId,
        matchId,
        JSON.stringify({
          seats: [{ playerId: seatId, seatIndex: 0, color: "red", isBot: false }],
          pawns: [{ pawnId: "red-0", playerId: seatId, index: 0 }],
        }),
        seatId,
      ],
    );

    const transcript = (await rpc(ada, "get_match_transcript", {
      p_match_id: matchId,
    })) as MatchTranscript;
    expect(transcript.gameType).toBe("ludo");
    expect(transcript.seats[0]).toMatchObject({ displayName: "Ada", avatarId: "fox" });
    // match_started and lobby events are excluded; the four visual events remain.
    expect(transcript.events.map((e) => e.event_type)).toEqual([
      "dice_rolled",
      "legal_move_selected",
      "match_completed",
    ]);

    const replay = buildReplay(transcript);
    expect(replay.steps[0].kind).toBe("start");
    expect(replay.steps.at(-1)).toMatchObject({ kind: "end", caption: "Ada won the match" });
    expect(replay.steps.find((s) => s.kind === "move")?.pawns.find((p) => p.id === "red-0")?.pathIndex).toBe(0);

    const history = (await rpc(ada, "get_my_match_history")) as { matchId: string; placement: number }[];
    expect(history).toContainEqual(expect.objectContaining({ matchId, placement: 1 }));

    await expect(
      rpc(stranger, "get_match_transcript", { p_match_id: matchId }),
    ).rejects.toThrow(/NOT_A_PARTICIPANT/);
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
