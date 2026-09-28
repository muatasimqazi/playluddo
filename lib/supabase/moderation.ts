import type { SupabaseClient } from "@supabase/supabase-js";

/** Report reasons, as stored in public.player_reports. */
export const REPORT_REASONS = {
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  spam: "Spam or scams",
  cheating: "Cheating or griefing",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Seats at this table held by people the signed-in player has blocked. */
export async function fetchBlockedPlayerIds(client: SupabaseClient, roomId: string): Promise<string[]> {
  const { data, error } = await client.rpc("blocked_player_ids", { p_room_id: roomId });
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

/** Blocks (or unblocks) the person in another seat — by account, so it lasts beyond this table. */
export async function setPlayerBlocked(
  client: SupabaseClient,
  roomId: string,
  playerId: string,
  blocked: boolean,
) {
  const { error } = await client.rpc("set_player_blocked", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_blocked: blocked,
  });
  if (error) throw error;
}

export async function reportPlayer(
  client: SupabaseClient,
  roomId: string,
  playerId: string,
  reason: ReportReason,
  details: string,
) {
  const { error } = await client.rpc("report_player", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_reason: reason,
    p_details: details.trim() || null,
  });
  if (error) throw error;
}
