import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameType } from "@/lib/board/types";
import type { MatchTranscript } from "@/lib/presentation/replay";

/** One finished match in the caller's history (docs/COMPETITIVE_ROADMAP.md F4.3). */
export interface MatchHistoryEntry {
  matchId: string;
  gameType: GameType;
  endedAt: string;
  endReason: "completed" | "abandoned" | null;
  placement: number | null;
  playerCount: number;
  opponents: string[];
}

/**
 * Fetches a full match transcript, following pagination until every event is in
 * hand, and returns it in the shape {@link buildReplay} consumes.
 */
export async function getMatchTranscript(
  client: SupabaseClient,
  matchId: string,
): Promise<MatchTranscript> {
  const limit = 500;
  let after = 0;
  let base: Omit<MatchTranscript, "events"> | null = null;
  const events: MatchTranscript["events"] = [];

  for (;;) {
    const { data, error } = await client.rpc("get_match_transcript", {
      p_match_id: matchId,
      p_after_sequence: after,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    const page = data as MatchTranscript;
    if (!base)
      base = {
        matchId: page.matchId,
        gameType: page.gameType,
        rules: page.rules,
        seats: page.seats,
        pawns: page.pawns,
        endedAt: page.endedAt,
        endReason: page.endReason,
      };
    events.push(...page.events);
    if (page.events.length < limit) break;
    after = page.events[page.events.length - 1].sequence;
  }

  return { ...(base as Omit<MatchTranscript, "events">), events };
}

export async function getMyMatchHistory(
  client: SupabaseClient,
  limit = 20,
  before?: string,
): Promise<MatchHistoryEntry[]> {
  const { data, error } = await client.rpc("get_my_match_history", {
    p_limit: limit,
    p_before: before ?? null,
  });
  if (error) throw new Error(error.message);
  return data as MatchHistoryEntry[];
}
