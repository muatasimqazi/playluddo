import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameType, PlayerColor } from "@/lib/board/types";

/** Tournaments (docs/COMPETITIVE_ROADMAP.md F4.1). */

export type TournamentStatus = "scheduled" | "active" | "complete" | "cancelled";

export interface TournamentSummary {
  id: string;
  name: string;
  teamId: string;
  teamName: string;
  size: 8 | 16;
  gameType: GameType;
  status: TournamentStatus;
  startsAt: string;
  checkInOpensAt: string;
  entrantCount: number;
  entered: boolean;
}

export interface TournamentEntrant {
  userId: string;
  displayName: string;
  seed: number;
  checkedIn: boolean;
  eliminated: boolean;
}

export interface TournamentSeat {
  /** The seat (players.id), for opening its profile. */
  playerId: string;
  displayName: string;
  color: PlayerColor;
  isBot: boolean;
  placement: number | null;
}

export interface TournamentTable {
  round: number;
  tableIndex: number;
  roomId: string | null;
  status: "in_progress" | "done";
  /** True when the signed-in player holds a seat at this table. */
  mine: boolean;
  seats: TournamentSeat[];
}

export interface Tournament {
  id: string;
  name: string;
  teamId: string;
  size: 8 | 16;
  gameType: GameType;
  status: TournamentStatus;
  checkInOpensAt: string;
  startsAt: string;
  winnerUserId: string | null;
  myUserId: string;
  entrants: TournamentEntrant[];
  tables: TournamentTable[];
}

export async function getMyTournaments(client: SupabaseClient): Promise<TournamentSummary[]> {
  const { data, error } = await client.rpc("get_my_tournaments");
  if (error) throw new Error(error.message);
  return data as TournamentSummary[];
}

export async function getTournament(
  client: SupabaseClient,
  tournamentId: string,
): Promise<Tournament> {
  const { data, error } = await client.rpc("get_tournament", { p_tournament_id: tournamentId });
  if (error) throw new Error(error.message);
  return data as Tournament;
}

export async function createTournament(
  client: SupabaseClient,
  args: {
    teamId: string;
    name: string;
    size: 8 | 16;
    gameType: GameType;
    checkInOpensAt: string;
    startsAt: string;
  },
): Promise<string> {
  const { data, error } = await client.rpc("create_tournament", {
    p_team_id: args.teamId,
    p_name: args.name,
    p_size: args.size,
    p_game_type: args.gameType,
    p_check_in_opens_at: args.checkInOpensAt,
    p_starts_at: args.startsAt,
  });
  if (error) throw new Error(error.message);
  return (data as { tournamentId: string }).tournamentId;
}

export async function joinTournament(client: SupabaseClient, tournamentId: string): Promise<void> {
  const { error } = await client.rpc("join_tournament", { p_tournament_id: tournamentId });
  if (error) throw new Error(error.message);
}

export async function leaveTournament(client: SupabaseClient, tournamentId: string): Promise<void> {
  const { error } = await client.rpc("leave_tournament", { p_tournament_id: tournamentId });
  if (error) throw new Error(error.message);
}

export async function checkInTournament(client: SupabaseClient, tournamentId: string): Promise<void> {
  const { error } = await client.rpc("check_in_tournament", { p_tournament_id: tournamentId });
  if (error) throw new Error(error.message);
}
