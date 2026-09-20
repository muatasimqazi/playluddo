import type { SupabaseClient } from "@supabase/supabase-js";

export interface TeamMember {
  userId: string;
  role: "owner" | "member";
  displayName: string;
  avatarId: string | null;
  joinedAt: string;
}

export interface TeamActiveRoom {
  roomId: string;
  code: string;
  status: "lobby" | "in_game";
  seatsTaken: number;
}

export interface Team {
  id: string;
  name: string;
  inviteCode: string;
  ownerUserId: string;
  createdAt: string;
  members: TeamMember[];
  activeRoom: TeamActiveRoom | null;
}

async function teamCall(
  client: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as Team[];
}

export function getMyTeams(client: SupabaseClient) {
  return teamCall(client, "get_my_teams");
}

export function createTeam(
  client: SupabaseClient,
  name: string,
  displayName: string,
  avatarId?: string,
) {
  return teamCall(client, "create_team", {
    p_name: name,
    p_display_name: displayName,
    p_avatar_id: avatarId || null,
  });
}

export function joinTeam(
  client: SupabaseClient,
  inviteCode: string,
  displayName: string,
  avatarId?: string,
) {
  return teamCall(client, "join_team", {
    p_invite_code: inviteCode,
    p_display_name: displayName,
    p_avatar_id: avatarId || null,
  });
}

export function leaveTeam(client: SupabaseClient, teamId: string) {
  return teamCall(client, "leave_team", { p_team_id: teamId });
}
