/**
 * Wire shape for `send_webrtc_signal` broadcasts. Ephemeral (never
 * persisted) — every seated client receives every signal on the shared
 * room channel and ignores anything not addressed to its own player id.
 */
export type WebRtcSignalPayload =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export interface WebRtcSignal {
  from: string;
  to: string;
  signal: WebRtcSignalPayload;
}

function isSignalPayload(value: unknown): value is WebRtcSignalPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.type === "offer" || v.type === "answer")
    return typeof v.sdp === "string";
  if (v.type === "ice") return typeof v.candidate === "object" && v.candidate !== null;
  return false;
}

export function parseWebRtcSignal(value: unknown): WebRtcSignal | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.from !== "string" ||
    typeof v.to !== "string" ||
    !isSignalPayload(v.signal)
  )
    return null;
  return { from: v.from, to: v.to, signal: v.signal };
}
