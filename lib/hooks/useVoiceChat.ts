"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  joinVoice as joinVoiceRpc,
  leaveVoice as leaveVoiceRpc,
  sendWebrtcSignal,
} from "../supabase/rpc";
import type { WebRtcSignalPayload } from "../realtime/webrtc-signal";
import { useRoomStore } from "../store/room-store";

/**
 * Full-mesh WebRTC audio for a room (rooms cap at 4 seats, so at most 3
 * connections per participant — no SFU needed). Signaling rides the room's
 * existing Supabase Realtime channel via `send_webrtc_signal` (clients can
 * never `channel.send()` directly — see the RLS note on realtime.messages
 * in supabase/migrations/20260913222114_rls_policies.sql); the roster
 * ("who's in the call") is just `roomState.players[].inVoice`, delivered
 * for free on every existing `state_updated` broadcast.
 */

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const SPEAKING_THRESHOLD = 12;
const SPEAKING_POLL_MS = 150;

interface Analysed {
  ctx: AudioContext;
  analyser: AnalyserNode;
}

interface Peer {
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
}

export interface VoiceChat {
  joined: boolean;
  connecting: boolean;
  muted: boolean;
  speakingPlayerIds: Set<string>;
  error: string | null;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
}

export function useVoiceChat(client: SupabaseClient, roomId: string): VoiceChat {
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const players = useRoomStore((s) => s.roomState?.players);
  const voiceSignals = useRoomStore((s) => s.voiceSignals);
  const consumeVoiceSignal = useRoomStore((s) => s.consumeVoiceSignal);

  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakingPlayerIds, setSpeakingPlayerIds] = useState<Set<string>>(
    () => new Set(),
  );

  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const earlyCandidates = useRef(
    new Map<string, RTCIceCandidateInit[]>(),
  );
  const analysed = useRef(new Map<string, Analysed>());
  const joinedRef = useRef(false);
  const mutedRef = useRef(false);

  const attachAnalyser = useCallback((id: string, stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analysed.current.set(id, { ctx, analyser });
    } catch {
      /* Speaking indicator is cosmetic — a failure here shouldn't break the call. */
    }
  }, []);

  const detachAnalyser = useCallback((id: string) => {
    const a = analysed.current.get(id);
    if (!a) return;
    void a.ctx.close();
    analysed.current.delete(id);
  }, []);

  const cleanupPeer = useCallback(
    (id: string) => {
      const peer = peers.current.get(id);
      if (!peer) return;
      peer.connection.close();
      peer.audio.srcObject = null;
      peer.audio.remove();
      peers.current.delete(id);
      detachAnalyser(id);
    },
    [detachAnalyser],
  );

  const sendSignal = useCallback(
    (to: string, signal: WebRtcSignalPayload) => {
      void sendWebrtcSignal(client, roomId, to, signal).catch(() => {
        /* The peer will retry once the next roster/ICE tick fires. */
      });
    },
    [client, roomId],
  );

  const ensurePeer = useCallback(
    (id: string, isOfferer: boolean): Peer => {
      const existing = peers.current.get(id);
      if (existing) return existing;

      const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const audio = new Audio();
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      // Safari is more reliable with MediaStream-backed audio attached to the DOM.
      audio.style.display = "none";
      document.body.appendChild(audio);
      const peer: Peer = {
        connection,
        audio,
        pendingCandidates: earlyCandidates.current.get(id) ?? [],
      };
      earlyCandidates.current.delete(id);
      peers.current.set(id, peer);

      localStream.current
        ?.getTracks()
        .forEach((track) => connection.addTrack(track, localStream.current!));

      connection.onicecandidate = (e) => {
        if (e.candidate) sendSignal(id, { type: "ice", candidate: e.candidate.toJSON() });
      };
      connection.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        audio.srcObject = stream;
        void audio.play().catch(() => {});
        attachAnalyser(id, stream);
      };
      connection.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(connection.connectionState))
          cleanupPeer(id);
      };

      if (isOfferer) {
        void connection
          .createOffer()
          .then((offer) => connection.setLocalDescription(offer))
          .then(() => {
            if (connection.localDescription)
              sendSignal(id, { type: "offer", sdp: connection.localDescription.sdp });
          });
      }

      return peer;
    },
    [attachAnalyser, cleanupPeer, sendSignal],
  );

  const leave = useCallback(() => {
    for (const id of Array.from(peers.current.keys())) cleanupPeer(id);
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    earlyCandidates.current.clear();
    if (myPlayerId) detachAnalyser(myPlayerId);
    joinedRef.current = false;
    setJoined(false);
    setSpeakingPlayerIds(new Set());
    void leaveVoiceRpc(client, roomId).catch(() => {});
  }, [client, roomId, myPlayerId, cleanupPeer, detachAnalyser]);

  const join = useCallback(() => {
    if (joinedRef.current || connecting) return;
    setError(null);
    setConnecting(true);
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(async (stream) => {
        stream.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
        localStream.current = stream;
        if (myPlayerId) attachAnalyser(myPlayerId, stream);
        await joinVoiceRpc(client, roomId);
        joinedRef.current = true;
        setJoined(true);
      })
      .catch((e) => {
        setError(
          e instanceof DOMException
            ? "Microphone access was denied."
            : e instanceof Error
              ? e.message
              : "Couldn't join voice chat.",
        );
      })
      .finally(() => setConnecting(false));
  }, [client, roomId, myPlayerId, connecting, attachAnalyser]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    localStream.current?.getTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, []);

  // Reconcile the mesh against the roster on every state_updated broadcast.
  useEffect(() => {
    if (!joined || !myPlayerId || !players) return;
    const wanted = new Set(
      players
        .filter((p) => p.id !== myPlayerId && p.inVoice && !p.isBot)
        .map((p) => p.id),
    );
    for (const id of wanted) {
      if (!peers.current.has(id)) ensurePeer(id, myPlayerId < id);
    }
    for (const id of Array.from(peers.current.keys())) {
      if (!wanted.has(id)) cleanupPeer(id);
    }
  }, [joined, myPlayerId, players, ensurePeer, cleanupPeer]);

  // Drain incoming signaling messages (offers/answers/ICE) addressed to us.
  useEffect(() => {
    if (voiceSignals.length === 0) return;
    for (const { id, signal } of voiceSignals) {
      if (signal.to !== myPlayerId) {
        consumeVoiceSignal(id);
        continue;
      }
      // Joining the voice roster broadcasts before joinVoiceRpc necessarily
      // resolves. Keep an offer received in that window queued; consuming it
      // here leaves both peers in voice with no connection to negotiate.
      if (!joined) continue;
      const from = signal.from;
      const payload = signal.signal;
      if (payload.type === "offer") {
        const peer = ensurePeer(from, false);
        void peer.connection
          .setRemoteDescription({ type: "offer", sdp: payload.sdp })
          .then(() => {
            const pending = peer.pendingCandidates.splice(0);
            return Promise.all(
              pending.map((c) => peer.connection.addIceCandidate(c)),
            );
          })
          .then(() => peer.connection.createAnswer())
          .then((answer) => peer.connection.setLocalDescription(answer))
          .then(() => {
            if (peer.connection.localDescription)
              sendSignal(from, { type: "answer", sdp: peer.connection.localDescription.sdp });
          });
      } else if (payload.type === "answer") {
        const peer = peers.current.get(from);
        if (peer && !peer.connection.currentRemoteDescription) {
          void peer.connection
            .setRemoteDescription({ type: "answer", sdp: payload.sdp })
            .then(() => {
              const pending = peer.pendingCandidates.splice(0);
              return Promise.all(
                pending.map((c) => peer.connection.addIceCandidate(c)),
              );
            });
        }
      } else if (payload.type === "ice") {
        const peer = peers.current.get(from);
        if (!peer) {
          const pending = earlyCandidates.current.get(from) ?? [];
          pending.push(payload.candidate);
          earlyCandidates.current.set(from, pending);
        } else if (peer.connection.remoteDescription) {
          void peer.connection.addIceCandidate(payload.candidate).catch(() => {});
        } else {
          peer.pendingCandidates.push(payload.candidate);
        }
      }
      consumeVoiceSignal(id);
    }
  }, [voiceSignals, joined, myPlayerId, ensurePeer, sendSignal, consumeVoiceSignal]);

  // Speaking indicator: poll each active analyser's volume.
  useEffect(() => {
    const data = new Uint8Array(256);
    const interval = setInterval(() => {
      const speaking = new Set<string>();
      for (const [id, { analyser }] of analysed.current) {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const value of data) sum += (value - 128) ** 2;
        if (Math.sqrt(sum / data.length) > SPEAKING_THRESHOLD) speaking.add(id);
      }
      setSpeakingPlayerIds((prev) => {
        if (prev.size === speaking.size && [...prev].every((id) => speaking.has(id)))
          return prev;
        return speaking;
      });
    }, SPEAKING_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onUnload = () => leave();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (joinedRef.current) leave();
    };
    // Intentionally only on unmount/unload — `leave` closes over the latest refs it needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { joined, connecting, muted, speakingPlayerIds, error, join, leave, toggleMute };
}
