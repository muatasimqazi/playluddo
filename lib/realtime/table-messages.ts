import type { SupabaseClient } from "@supabase/supabase-js";
export interface TableMessage {
  id: string;
  playerId: string;
  text: string;
  kind: "chat" | "reaction";
  createdAt: string;
}
export function parseTableMessage(value: unknown): TableMessage | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    typeof v.playerId !== "string" ||
    typeof v.text !== "string" ||
    v.text.length > 240 ||
    !["chat", "reaction"].includes(String(v.kind)) ||
    typeof v.createdAt !== "string"
  )
    return null;
  return v as unknown as TableMessage;
}

export async function fetchTableMessages(
  client: SupabaseClient,
  roomId: string,
): Promise<TableMessage[]> {
  const { data, error } = await client
    .from("table_messages")
    .select("id,player_id,text,kind,created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? [])
    .reverse()
    .map((row) => ({
      id: row.id,
      playerId: row.player_id,
      text: row.text,
      kind: row.kind,
      createdAt: row.created_at,
    }));
}
