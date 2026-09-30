import posthog from "posthog-js";

/**
 * ICE outcome tracking for the table call (Section 7, V1): one
 * `call_ice_outcome` event per peer connection that either connects or fails,
 * so the failure rate is failed / (connected + failed). A connection closed
 * before either (someone left mid-setup) is not counted.
 *
 * Only transport facts are sent — never SDP, IP addresses, candidates, player
 * ids or anything about age (Section 15, R10).
 */

export type IceOutcome = "connected" | "failed";

/** How the winning candidate pair reached the peer; `relay` means via TURN. */
export type CandidateType = "host" | "srflx" | "prflx" | "relay" | "unknown";

export interface IceOutcomeEvent {
  outcome: IceOutcome;
  /** A TURN server was in the ICE set (false means the STUN-only fallback). */
  turn_offered: boolean;
  /** The local side of the selected pair, when connected. */
  candidate_type: CandidateType | null;
  /** Milliseconds from creating the connection to the outcome. */
  ms: number;
  /** The table carries video (V0), so the connection has a video section. */
  video_table: boolean;
}

/** Whether an ICE server set includes a TURN relay (`turn:` or `turns:`). */
export function offersTurn(servers: RTCIceServer[]): boolean {
  return servers.some((s) =>
    (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)),
  );
}

/**
 * The local candidate type of the selected pair in an RTCStatsReport, read as
 * plain stat objects so it can be tested without a browser.
 */
export function selectedCandidateType(stats: Iterable<Record<string, unknown>>): CandidateType {
  const byId = new Map<string, Record<string, unknown>>();
  for (const s of stats) byId.set(String(s.id), s);

  let pair: Record<string, unknown> | undefined;
  // The transport names the selected pair; fall back to a nominated,
  // succeeded pair where selectedCandidatePairId isn't exposed (Firefox).
  for (const s of byId.values()) {
    if (s.type === "transport" && typeof s.selectedCandidatePairId === "string") {
      pair = byId.get(s.selectedCandidatePairId);
      break;
    }
  }
  pair ??= [...byId.values()].find(
    (s) => s.type === "candidate-pair" && s.state === "succeeded" && s.nominated === true,
  );

  const local = pair ? byId.get(String(pair.localCandidateId)) : undefined;
  const type = local?.candidateType;
  return type === "host" || type === "srflx" || type === "prflx" || type === "relay"
    ? type
    : "unknown";
}

export function captureIceOutcome(event: IceOutcomeEvent) {
  // posthog is only initialized when NEXT_PUBLIC_POSTHOG_KEY is set.
  if (!posthog.__loaded) return;
  posthog.capture("call_ice_outcome", { ...event });
}
