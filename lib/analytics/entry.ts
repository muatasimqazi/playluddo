import type { EntryPoint, PlayContext } from "./events";

/**
 * How this tab arrived at a room (docs/analytics.md, `entry_point`).
 *
 * Every way into a table ends at `/room?id=…`, so the place that sends the
 * player there tags the room first. A room link opened with no tag (shared,
 * scanned or pasted) counts as an invite link. Tags live in sessionStorage,
 * keyed by room, so a refresh keeps them; they never leave the device.
 */

const KEY = "luddo-analytics-entry-v1";

export interface RoomEntry {
  entry_point: EntryPoint;
  play_context: PlayContext;
}

function read(): Record<string, RoomEntry> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, RoomEntry>) : {};
  } catch {
    return {};
  }
}

export function tagRoomEntry(roomId: string, entry: RoomEntry) {
  if (typeof window === "undefined" || !roomId) return;
  try {
    const all = read();
    all[roomId] = entry;
    const keys = Object.keys(all);
    // A handful of rooms per tab is plenty.
    for (const old of keys.slice(0, Math.max(0, keys.length - 20))) delete all[old];
    window.sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* Private mode: the room falls back to an invite link. */
  }
}

export function roomEntry(roomId: string, isParty: boolean): RoomEntry {
  const tagged = typeof window === "undefined" ? undefined : read()[roomId];
  if (tagged) return isParty ? { ...tagged, play_context: "party" } : tagged;
  return isParty
    ? { entry_point: "party_qr", play_context: "party" }
    : { entry_point: "invite_link", play_context: "private_room" };
}
