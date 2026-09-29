import type { SupabaseClient } from "@supabase/supabase-js";

/** One team member's record in a weekly season (docs/COMPETITIVE_ROADMAP.md F4.2). */
export interface SeasonStanding {
  rank: number;
  userId: string;
  displayName: string;
  avatarId: string | null;
  wins: number;
  played: number;
}

export interface SeasonChampion {
  userId: string;
  displayName: string;
  avatarId: string | null;
  wins: number;
  played: number;
}

export interface TeamSeason {
  /** Monday (UTC) of the season's ISO week, as YYYY-MM-DD. */
  seasonStart: string;
  /** Sunday (UTC) of the same week. */
  seasonEnd: string;
  isCurrent: boolean;
  standings: SeasonStanding[];
  /** The recorded winner of a closed week; null while a season is in progress. */
  champion: SeasonChampion | null;
}

export interface SeasonTitle {
  teamId: string;
  teamName: string;
  seasonStart: string;
  wins: number;
  played: number;
}

/** A team's weekly season. `weeksAgo` 0 = this week, 1 = last week, and so on. */
export async function getTeamSeason(
  client: SupabaseClient,
  teamId: string,
  weeksAgo = 0,
): Promise<TeamSeason> {
  const { data, error } = await client.rpc("get_team_season", {
    p_team_id: teamId,
    p_weeks_ago: weeksAgo,
  });
  if (error) throw new Error(error.message);
  return data as TeamSeason;
}

/** The signed-in player's champion titles across all their teams, newest first. */
export async function getMySeasonTitles(
  client: SupabaseClient,
): Promise<SeasonTitle[]> {
  const { data, error } = await client.rpc("get_my_season_titles");
  if (error) throw new Error(error.message);
  return data as SeasonTitle[];
}
