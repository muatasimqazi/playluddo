import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

/** Isolated local-only clients. Never operates on an existing user's room. */
it("a team's active room is discoverable by teammates and rejects non-members", async () => {
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
  const owner = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const teammate = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const outsider = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userIds: string[] = [];
  let roomId: string | undefined;
  let teamId: string | undefined;

  async function rpc(
    client: typeof owner,
    name: string,
    args: Record<string, unknown> = {},
  ) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  }

  try {
    for (const client of [owner, teammate, outsider]) {
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user)
        throw new Error(error?.message ?? "No test identity");
      userIds.push(data.user.id);
    }

    const created = await rpc(owner, "create_team", {
      p_name: "Weekend Crew",
      p_display_name: "Owner",
    });
    teamId = created[0].id;
    await rpc(teammate, "join_team", {
      p_invite_code: created[0].inviteCode,
      p_display_name: "Teammate",
    });

    // Before any room exists, neither teammate sees an activeRoom.
    const beforeRoom = await rpc(teammate, "get_my_teams");
    expect(beforeRoom[0].activeRoom).toBeNull();

    // Creating a room for a team you don't belong to is rejected.
    const denied = await outsider.rpc("create_room", {
      p_display_name: "Outsider",
      p_team_id: teamId,
    });
    expect(denied.error?.message).toBe("NOT_TEAM_MEMBER");

    const room = await rpc(owner, "create_room", {
      p_display_name: "Owner",
      p_team_id: teamId,
    });
    roomId = room.roomId;

    // The teammate discovers the room through get_my_teams, no code shared.
    const teams = await rpc(teammate, "get_my_teams");
    const mine = teams.find((t: { id: string }) => t.id === teamId);
    expect(mine.activeRoom).toMatchObject({
      roomId: room.roomId,
      code: room.code,
      status: "lobby",
      seatsTaken: 1,
    });

    // And can actually join with that discovered code.
    const joined = await rpc(teammate, "join_room", {
      p_code: mine.activeRoom.code,
      p_display_name: "Teammate",
    });
    expect(joined.playerId).toBeTruthy();

    const afterJoin = await rpc(owner, "get_my_teams");
    expect(
      afterJoin.find((t: { id: string }) => t.id === teamId).activeRoom
        .seatsTaken,
    ).toBe(2);
  } finally {
    if (roomId || teamId || userIds.length) {
      const db = new Client({
        connectionString:
          process.env.SUPABASE_DB_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      });
      await db.connect();
      try {
        if (roomId)
          await db.query("delete from public.rooms where id=$1", [roomId]);
        if (teamId)
          await db.query("delete from public.teams where id=$1", [teamId]);
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
