import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { GameRoomState } from "../board/types";
import { parseTableMessage, type TableMessage } from "./table-messages";
import { parseWebRtcSignal, type WebRtcSignal } from "./webrtc-signal";

/**
 * Per docs/PRD.md Section 6.3/7: subscribe with `private: true` — an
 * unauthenticated/public-mode subscribe skips RLS entirely on Realtime
 * Broadcast, which would defeat the room-membership policy on
 * `realtime.messages`. This is not optional.
 *
 * `state_updated` carries the full GameRoomState snapshot (small — 4
 * players x 4 pawns) on every accepted server transition, not a diff.
 */
export function subscribeToRoom(
  client: SupabaseClient,
  roomId: string,
  onState: (state: GameRoomState) => void,
  options?: {
    onStatus?: (status: string) => void;
    onMessage?: (message: TableMessage) => void;
    onSignal?: (signal: WebRtcSignal) => void;
  },
): RealtimeChannel {
  const channel = client.channel(`room:${roomId}`, {
    config: { private: true },
  });

  channel.on("broadcast", { event: "state_updated" }, ({ payload }) => {
    onState(payload as GameRoomState);
  });

  channel.on("broadcast", { event: "table_message" }, ({ payload }) => {
    const message = parseTableMessage(payload);
    if (message) options?.onMessage?.(message);
  });
  channel.on("broadcast", { event: "webrtc_signal" }, ({ payload }) => {
    const signal = parseWebRtcSignal(payload);
    if (signal) options?.onSignal?.(signal);
  });
  channel.subscribe(status => options?.onStatus?.(status));

  return channel;
}

export interface MatchEventRow {
  id: number;
  sequence: number;
  event_type: string;
  player_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * The activity feed reads match_events directly (RLS already permits a
 * seated player to select it) instead of a separate "flavor event"
 * broadcast — one less channel/shape to keep in sync, and match_events is
 * already the durable log everything else replays from.
 */
export async function fetchRecentEvents(
  client: SupabaseClient,
  roomId: string,
  limit = 100,
): Promise<MatchEventRow[]> {
  const { data, error } = await client
    .from("match_events")
    .select("id, sequence, event_type, player_id, payload, created_at")
    .eq("room_id", roomId)
    .order("sequence", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).reverse();
}
