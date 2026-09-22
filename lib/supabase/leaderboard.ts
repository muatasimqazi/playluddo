import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarId: string | null;
  wins: number;
}

async function leaderboardCall(
  client: SupabaseClient,
  args?: Record<string, unknown>,
) {
  const { data, error } = await client.rpc("get_leaderboard", args);
  if (error) throw new Error(error.message);
  return data as LeaderboardEntry[];
}

export function getGlobalLeaderboard(client: SupabaseClient, limit = 50) {
  return leaderboardCall(client, { p_limit: limit });
}

export function getTeamLeaderboard(
  client: SupabaseClient,
  teamId: string,
  limit = 50,
) {
  return leaderboardCall(client, { p_team_id: teamId, p_limit: limit });
}

export async function getMyWins(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_my_wins");
  if (error) throw new Error(error.message);
  return data as number;
}
