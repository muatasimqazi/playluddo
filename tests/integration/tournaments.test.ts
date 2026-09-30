import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

/**
 * F4.1: a team owner schedules an 8-player tournament, teammates enter and check
 * in, the scheduled start seeds round 1, the top two of each table advance to
 * the final, and the champion is crowned with the trophy achievement. Table
 * results are simulated via the superuser connection (no real games are played);
 * everything else goes through the RPCs as the accounts.
 */
it("runs an 8-player team tournament from schedule to champion", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Tournament integration tests only run against local Supabase.");
  const supaUrl = url;
  const supaKey = anonKey;

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

  const clients: SupabaseClient[] = [];
  const userIds: string[] = [];

  async function signIn(name: string) {
    const c = createClient(supaUrl, supaKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await c.auth.signInAnonymously();
    const id = data.user!.id;
    await db.query(
      "update auth.users set is_anonymous = false, raw_user_meta_data = jsonb_build_object('display_name', $2) where id = $1",
      [id, name],
    );
    clients.push(c);
    userIds.push(id);
    return { c, id };
  }

  // Finish a round's tables: seat 0 = 1st … seat 3 = 4th, all real accounts.
  async function completeRound(tournamentId: string, round: number) {
    const { rows: tables } = await db.query<{ room_id: string; current_match_id: string }>(
      `select tt.room_id, r.current_match_id
       from public.tournament_tables tt join public.rooms r on r.id = tt.room_id
       where tt.tournament_id = $1 and tt.round = $2`,
      [tournamentId, round],
    );
    for (const table of tables) {
      const { rows: seats } = await db.query<{ id: string; user_id: string | null; seat_index: number; color: string }>(
        "select id, user_id, seat_index, color from public.players where room_id = $1 order by seat_index",
        [table.room_id],
      );
      for (const seat of seats) {
        await db.query(
          `insert into public.match_results
             (match_id, player_id, user_id, account_kind, ended_under_takeover, seat_index, color, placement, stats)
           values ($1,$2,$3,'account',false,$4,$5,$6,'{}')`,
          [table.current_match_id, seat.id, seat.user_id, seat.seat_index, seat.color, seat.seat_index + 1],
        );
      }
      await db.query("update public.rooms set match_end_reason='completed', status='summary' where id=$1", [
        table.room_id,
      ]);
    }
  }

  try {
    const owner = await signIn("Cap");
    const rest = [];
    for (let i = 2; i <= 8; i++) rest.push(await signIn(`P${i}`));

    // Team of 8.
    const created = (await rpc(owner.c, "create_team", { p_name: "The Eight", p_display_name: "Cap" })) as {
      inviteCode: string;
    }[];
    const code = created[0].inviteCode;
    for (let i = 0; i < rest.length; i++) await rpc(rest[i].c, "join_team", { p_invite_code: code, p_display_name: `P${i + 2}` });

    // Schedule an 8-player tournament and fill it.
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const { data: teamRow } = await owner.c.rpc("get_my_teams");
    const teamId = (teamRow as { id: string }[])[0].id;
    const tournamentId = (
      (await rpc(owner.c, "create_tournament", {
        p_team_id: teamId,
        p_name: "Cup",
        p_size: 8,
        p_game_type: "ludo",
        p_check_in_opens_at: new Date(Date.now() + 60_000).toISOString(),
        p_starts_at: soon,
      })) as { tournamentId: string }
    ).tournamentId;
    for (const r of rest) await rpc(r.c, "join_tournament", { p_tournament_id: tournamentId });

    const full = (await rpc(owner.c, "get_tournament", { p_tournament_id: tournamentId })) as {
      entrants: unknown[];
    };
    expect(full.entrants).toHaveLength(8);

    // Force the start time to pass, then run the scheduler.
    await db.query("update public.tournaments set starts_at = now() - interval '1 minute' where id = $1", [
      tournamentId,
    ]);
    await db.query("select private.start_due_tournaments()");

    const round1 = (await rpc(owner.c, "get_tournament", { p_tournament_id: tournamentId })) as {
      status: string;
      tables: { round: number }[];
    };
    expect(round1.status).toBe("active");
    expect(round1.tables.filter((t) => t.round === 1)).toHaveLength(2);

    await completeRound(tournamentId, 1);
    const afterR1 = (await rpc(owner.c, "get_tournament", { p_tournament_id: tournamentId })) as {
      tables: { round: number }[];
    };
    expect(afterR1.tables.filter((t) => t.round === 2)).toHaveLength(1);

    await completeRound(tournamentId, 2);
    const done = (await rpc(owner.c, "get_tournament", { p_tournament_id: tournamentId })) as {
      status: string;
      winnerUserId: string | null;
    };
    expect(done.status).toBe("complete");
    expect(done.winnerUserId).toBeTruthy();
    const champ = await db.query(
      "select count(*)::int as n from public.player_achievements where achievement_id='tournament_win' and user_id=$1",
      [done.winnerUserId],
    );
    expect(champ.rows[0].n).toBe(1);

    // A non-member cannot read it.
    const stranger = await signIn("Stranger");
    await expect(rpc(stranger.c, "get_tournament", { p_tournament_id: tournamentId })).rejects.toThrow(
      /NOT_TEAM_MEMBER/,
    );
  } finally {
    try {
      // Rooms spawned by the bracket cascade from tournament_tables; clean via the tournament + users.
      if (userIds.length)
        await db.query("delete from auth.users where id = any($1::uuid[])", [userIds]);
    } finally {
      await Promise.all(clients.map((c) => c.auth.signOut().catch(() => {})));
      await db.end();
    }
  }
}, 60000);
