import { describe, expect, it } from "vitest";
import { offersTurn, selectedCandidateType } from "../../lib/analytics/ice";

describe("offersTurn", () => {
  it("is false for the STUN-only fallback", () => {
    expect(offersTurn([{ urls: "stun:stun.l.google.com:19302" }])).toBe(false);
  });
  it("finds turn: and turns: urls, in strings or arrays", () => {
    expect(offersTurn([{ urls: "turn:global.turn.twilio.com:3478?transport=udp" }])).toBe(true);
    expect(
      offersTurn([
        { urls: "stun:global.stun.twilio.com:3478" },
        { urls: ["turns:global.turn.twilio.com:443?transport=tcp"] },
      ]),
    ).toBe(true);
  });
});

describe("selectedCandidateType", () => {
  const candidates = [
    { id: "L1", type: "local-candidate", candidateType: "host" },
    { id: "L2", type: "local-candidate", candidateType: "relay" },
    { id: "P1", type: "candidate-pair", localCandidateId: "L1", state: "failed", nominated: false },
    { id: "P2", type: "candidate-pair", localCandidateId: "L2", state: "succeeded", nominated: true },
  ];

  it("follows the transport's selected pair", () => {
    const stats = [...candidates, { id: "T", type: "transport", selectedCandidatePairId: "P1" }];
    expect(selectedCandidateType(stats)).toBe("host");
  });
  it("falls back to the nominated, succeeded pair without a transport", () => {
    expect(selectedCandidateType(candidates)).toBe("relay");
  });
  it("is unknown when no pair was selected", () => {
    expect(selectedCandidateType(candidates.slice(0, 3))).toBe("unknown");
    expect(selectedCandidateType([])).toBe("unknown");
  });
});
