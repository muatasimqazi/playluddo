/**
 * Once-only sends (docs/analytics.md, "Duplicate protection").
 *
 * A lifecycle event is recorded under a key such as
 * `game_started:<match id>:<seat id>` before it is sent; a key already present
 * is skipped. The record lives in localStorage, so a refresh, a reconnect
 * replaying a snapshot, or the same table open in two tabs cannot send it
 * twice, and in memory too, for private windows where storage fails. Records
 * expire after 48 hours and at most 200 are kept. The keys stay on this
 * device; they are never sent anywhere.
 */

const STORAGE_KEY = "luddo-analytics-sent-v1";
const TTL_MS = 48 * 60 * 60 * 1000;
const MAX_KEYS = 200;

export interface SentRecord {
  /** When it was first sent (ms since epoch). */
  at: number;
  /** Small extra facts kept with the record, e.g. a game's start time. */
  data?: Record<string, number | string | boolean>;
}

const memory = new Map<string, SentRecord>();

function load(now: number): Record<string, SentRecord> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, SentRecord>;
    const fresh: Record<string, SentRecord> = {};
    for (const key of Object.keys(parsed)) {
      const record = parsed[key];
      if (record && typeof record.at === "number" && now - record.at < TTL_MS) fresh[key] = record;
    }
    return fresh;
  } catch {
    return {};
  }
}

function save(records: Record<string, SentRecord>) {
  try {
    const keys = Object.keys(records).sort((a, b) => records[b].at - records[a].at);
    const trimmed: Record<string, SentRecord> = {};
    for (const key of keys.slice(0, MAX_KEYS)) trimmed[key] = records[key];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Private mode or full storage: the in-memory record still covers this page.
  }
}

/** The record for a key, if it was sent in the last 48 hours on this device. */
export function sentRecord(key: string, now = Date.now()): SentRecord | undefined {
  const fromMemory = memory.get(key);
  if (fromMemory && now - fromMemory.at < TTL_MS) return fromMemory;
  if (typeof window === "undefined") return undefined;
  const stored = load(now)[key];
  if (stored) memory.set(key, stored);
  return stored;
}

/**
 * Claims a key: true the first time (the caller should send), false if it was
 * already claimed on this device.
 */
export function claimOnce(
  key: string,
  data?: SentRecord["data"],
  now = Date.now(),
): boolean {
  if (sentRecord(key, now)) return false;
  const record: SentRecord = data ? { at: now, data } : { at: now };
  memory.set(key, record);
  if (typeof window !== "undefined") {
    const records = load(now);
    records[key] = record;
    save(records);
  }
  return true;
}

/** Test helper: forgets everything in memory. */
export function resetDedupeMemory() {
  memory.clear();
}
