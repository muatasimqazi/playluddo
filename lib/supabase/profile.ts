import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerColor } from "../board/types";

/** One opponent the player has met at a table (docs/COMPETITIVE_ROADMAP.md F3.1). */
export interface HeadToHead {
  displayName: string;
  avatarId: string | null;
  games: number;
  wins: number;
}

export interface WinRateByMode {
  /** matches.game_type — "ludo" or "snakes_and_ladders". */
  mode: string;
  games: number;
  wins: number;
}

/** A profile that the viewer is allowed to see in full. */
export interface VisibleProfile {
  visibility: "visible";
  isSelf: boolean;
  /** Only ever true for the player themselves — their profile is hidden from others. */
  hidden: boolean;
  displayName: string;
  avatarId: string | null;
  country: string | null;
  gamesPlayed: number;
  wins: number;
  winRateByMode: WinRateByMode[];
  totalCaptures: number;
  totalSixes: number;
  favouriteColour: PlayerColor | null;
  /** Best comeback proxy: most rolls in a row without a six in a match still won. */
  bestComeback: number;
  headToHead: HeadToHead[];
}

/** A profile the viewer can't see the stats of, or a seat with no account. */
export interface OpaqueProfile {
  visibility: "hidden" | "guest" | "none";
  displayName?: string;
  avatarId?: string | null;
  country?: string | null;
}

export type PlayerProfile = VisibleProfile | OpaqueProfile;

async function profileCall(
  client: SupabaseClient,
  playerId?: string,
): Promise<PlayerProfile> {
  const { data, error } = await client.rpc(
    "get_player_profile",
    playerId ? { p_player_id: playerId } : {},
  );
  if (error) throw new Error(error.message);
  return data as PlayerProfile;
}

/** The signed-in player's own profile — always returned in full. */
export function getMyProfile(client: SupabaseClient) {
  return profileCall(client);
}

/**
 * The profile of the account behind a seat (players.id), opened from that
 * seat's avatar. Respects the player's privacy setting; returns an opaque
 * marker for guests, bots and hidden profiles.
 */
export function getPlayerProfile(client: SupabaseClient, playerId: string) {
  return profileCall(client, playerId);
}
