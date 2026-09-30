"use client";

// The audio-only voice call grew a video track (Section 7, V2) and became
// useTableCall. This shim keeps the old name and type working for callers that
// only need the voice controls; new call sites should import useTableCall.
export { useTableCall as useVoiceChat, type TableCall as VoiceChat } from "./useTableCall";
