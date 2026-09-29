import type { SupabaseClient } from "@supabase/supabase-js";

/** A friend's currently-joinable table (F3.6), mirroring a team's active room. */
export interface FriendActiveRoom {
  roomId: string;
  code: string;
  status: "lobby" | "in_game";
  seatsTaken: number;
  maxPlayers: number;
}

export interface Friend {
  userId: string;
  displayName: string;
  avatarId: string | null;
  level: number;
  status: "pending" | "accepted";
  /** For pending rows: "incoming" (they asked us) or "outgoing" (we asked). */
  direction: "incoming" | "outgoing" | null;
  activeRoom: FriendActiveRoom | null;
}

export interface RecentPlayer {
  userId: string;
  displayName: string;
  avatarId: string | null;
  level: number;
  isFriend: boolean;
  activeRoom: FriendActiveRoom | null;
}

export async function getMyFriendCode(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_my_friend_code");
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getFriends(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_friends");
  if (error) throw new Error(error.message);
  return data as Friend[];
}

export async function getRecentPlayers(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_recent_players");
  if (error) throw new Error(error.message);
  return data as RecentPlayer[];
}

/** Sends a friend request by the other player's friend code. */
export async function sendFriendRequest(client: SupabaseClient, code: string) {
  const { error } = await client.rpc("send_friend_request", { p_code: code });
  if (error) throw new Error(error.message);
}

/** "Add friend" on a seat — resolves the account behind that seat server-side. */
export async function addFriendFromSeat(client: SupabaseClient, playerId: string) {
  const { error } = await client.rpc("add_friend_from_seat", { p_player_id: playerId });
  if (error) throw new Error(error.message);
}

/** "Add friend" from the recently-played list (bounded to recent co-players). */
export async function addRecentPlayerFriend(client: SupabaseClient, userId: string) {
  const { error } = await client.rpc("add_recent_player_friend", { p_user_id: userId });
  if (error) throw new Error(error.message);
}

export async function respondFriendRequest(
  client: SupabaseClient,
  friendUserId: string,
  accept: boolean,
) {
  const { error } = await client.rpc("respond_friend_request", {
    p_friend: friendUserId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
}

export async function removeFriend(client: SupabaseClient, friendUserId: string) {
  const { error } = await client.rpc("remove_friend", { p_friend: friendUserId });
  if (error) throw new Error(error.message);
}
