import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

/**
 * F4.2: a team's weekly season standings are derived from match_results in the
 * team's rooms, a closed week records its champion once, and the champion shows
 * up in the winner's titles. Uses anon clients for the account RPCs and the
 * superuser connection to seed teams, rooms and completed matches.
 */
it("builds weekly standings, records a champion, and lists titles", async () => {
  const env = parseEnv(readFileSync(".env.local", "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error("Configure local Supabase in .env.local before running these tests.");
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Team-season integration tests only run against local Supabase.");

  const mk = () =>
    createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sara = mk();
  const nils = mk();
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

  // A completed match in the team room: `winner` places 1st, the other 2nd.
  async function seedMatch(winnerId: string, loserId: string, endedAt: string) {
    const matchId = randomUUID();
    await db.query(
      `insert into public.matches (id, room_id, game_type, rules, ended_at, end_reason)
       values ($1, $2, 'ludo', '{"pawnsToWin":4}', ${endedAt}, 'completed')`,
      [matchId, roomId],
    );
    await db.query(
      `insert into public.match_results
         (match_id, player_id, user_id, account_kind, ended_under_takeover, seat_index, color, placement, stats)
       values ($1, $2, $4, 'account', false, 0, 'red',  1, '{}'),
              ($1, $3, $5, 'account', false, 1, 'blue', 2, '{}')`,
      [matchId, randomUUID(), randomUUID(), winnerId, loserId],
    );
  }

  try {
    const { data: a } = await sara.auth.signInAnonymously();
    const { data: b } = await nils.auth.signInAnonymously();
    const saraId = a.user!.id;
    const nilsId = b.user!.id;
    userIds.push(saraId, nilsId);
    await db.query(
      `update auth.users set is_anonymous = false,
         raw_user_meta_data = jsonb_build_object('display_name', case when id = $1 then 'Sara' else 'Nils' end)
       where id = any($2::uuid[])`,
      [saraId, [saraId, nilsId]],
    );

    // Sara owns the team; Nils joins it.
    const created = (await rpc(sara, "create_team", {
      p_name: "The Dice Club",
      p_display_name: "Sara",
    })) as { id: string; inviteCode: string }[];
    const teamId = created[0].id;
    await rpc(nils, "join_team", { p_invite_code: created[0].inviteCode, p_display_name: "Nils" });

    await db.query(
      `insert into public.rooms (id, code, game_type, status, team_id)
       values ($1, $2, 'ludo', 'summary', $3)`,
      [roomId, `TS${Math.floor(Math.random() * 9000 + 1000)}`, teamId],
    );

    // This week: Sara wins two, Nils wins one.
    const thisWeek =
      "(date_trunc('week', now() at time zone 'UTC') + interval '2 days') at time zone 'UTC'";
    await seedMatch(saraId, nilsId, thisWeek);
    await seedMatch(saraId, nilsId, thisWeek);
    await seedMatch(nilsId, saraId, thisWeek);

    // Last week: Sara wins the only game, so she is that season's champion.
    const lastWeek =
      "(date_trunc('week', now() at time zone 'UTC') - interval '5 days') at time zone 'UTC'";
    await seedMatch(saraId, nilsId, lastWeek);

    // Current week: standings, no champion yet.
    const current = (await rpc(sara, "get_team_season", { p_team_id: teamId, p_weeks_ago: 0 })) as {
      isCurrent: boolean;
      champion: unknown;
      standings: { userId: string; rank: number; wins: number; played: number }[];
    };
    expect(current.isCurrent).toBe(true);
    expect(current.champion).toBeNull();
    expect(current.standings[0]).toMatchObject({ userId: saraId, rank: 1, wins: 2, played: 3 });
    expect(current.standings[1]).toMatchObject({ userId: nilsId, rank: 2, wins: 1, played: 3 });

    // Last week: reading it records the champion.
    const past = (await rpc(sara, "get_team_season", { p_team_id: teamId, p_weeks_ago: 1 })) as {
      isCurrent: boolean;
      champion: { userId: string; wins: number; played: number } | null;
    };
    expect(past.isCurrent).toBe(false);
    expect(past.champion).toMatchObject({ userId: saraId, wins: 1, played: 1 });

    const recorded = await db.query(
      "select user_id, wins from public.team_season_champions where team_id = $1",
      [teamId],
    );
    expect(recorded.rows).toHaveLength(1);
    expect(recorded.rows[0].user_id).toBe(saraId);

    // The title shows up for Sara, but not for Nils.
    const saraTitles = (await rpc(sara, "get_my_season_titles")) as { teamId: string }[];
    expect(saraTitles).toContainEqual(expect.objectContaining({ teamId, teamName: "The Dice Club" }));
    const nilsTitles = (await rpc(nils, "get_my_season_titles")) as unknown[];
    expect(nilsTitles).toHaveLength(0);

    // A non-member cannot read the team's season.
    const stranger = mk();
    try {
      const { data: s } = await stranger.auth.signInAnonymously();
      userIds.push(s.user!.id);
      await expect(rpc(stranger, "get_team_season", { p_team_id: teamId })).rejects.toThrow(
        /NOT_TEAM_MEMBER/,
      );
    } finally {
      await stranger.auth.signOut();
    }
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
