import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameRoomState } from "@/lib/board/types";

/** Watching live tables (docs/COMPETITIVE_ROADMAP.md F4.4). */

/** Host turns watching on, or any seated human turns it off (evicting watchers). */
export async function setWatching(
  client: SupabaseClient,
  roomId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await client.rpc("set_watching", {
    p_room_id: roomId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
}

/** Start watching. Returns the private realtime topic to subscribe to. */
export async function joinWatch(
  client: SupabaseClient,
  roomId: string,
  displayName: string,
): Promise<{ roomId: string; watchTopic: string }> {
  const { data, error } = await client.rpc("join_watch", {
    p_room_id: roomId,
    p_display_name: displayName,
  });
  if (error) throw new Error(error.message);
  return data as { roomId: string; watchTopic: string };
}

export async function leaveWatch(client: SupabaseClient, roomId: string): Promise<void> {
  const { error } = await client.rpc("leave_watch", { p_room_id: roomId });
  if (error) throw new Error(error.message);
}

export async function getWatchState(
  client: SupabaseClient,
  roomId: string,
): Promise<GameRoomState> {
  const { data, error } = await client.rpc("get_watch_state", { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data as GameRoomState;
}

export async function watcherReact(
  client: SupabaseClient,
  roomId: string,
  text: string,
): Promise<void> {
  const { error } = await client.rpc("watcher_react", { p_room_id: roomId, p_text: text });
  if (error) throw new Error(error.message);
}
