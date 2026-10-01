"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  captureIceOutcome,
  offersTurn,
  selectedCandidateType,
  type CandidateType,
  type IceOutcome,
} from "../analytics/ice";
import {
  fetchIceServers,
  joinVoice as joinVoiceRpc,
  leaveVoice as leaveVoiceRpc,
  sendWebrtcSignal,
  setCameraOn as setCameraOnRpc,
} from "../supabase/rpc";
import type { WebRtcSignalPayload } from "../realtime/webrtc-signal";
import { useRoomStore } from "../store/room-store";

/**
 * Full-mesh WebRTC audio and optional video for a room (Section 7, V2).
 * Generalizes the audio-only call (formerly useVoiceChat): every player still
 * connects directly to every other (at most 3 connections for 4 seats, no SFU),
 * signaling still rides `send_webrtc_signal` on the room channel, and the roster
 * is still `players[].inVoice` / `players[].cameraOn` from the state snapshot.
 *
 * Video only exists on a table the server marks `videoAllowed` (V0: every seat
 * signed-in and 18+, private room, feature on). On such a table each connection
 * carries a video transceiver from the start, so the camera can be toggled with
 * `replaceTrack` inside the negotiated envelope — no renegotiation. Audio-only
 * tables negotiate with no video section at all, so the server's V0 rejection of
 * video SDP never trips on a plain voice call.
 *
 * Blocking (V4) is enforced where media is sent: a blocked peer (either
 * direction) gets `replaceTrack(null)` on both senders, so their device never
 * receives this player's audio or video. Local muting alone is not enough.
 */

// STUN-only default (V1): replaced at join time with a Twilio-backed set that
// includes a TURN relay, fetched via fetchIceServers. STUN alone fails behind
// strict NATs, so this is only the fallback if that fetch can't complete.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
const SPEAKING_THRESHOLD = 12;
const SPEAKING_POLL_MS = 150;

// Small video keeps the mesh cheap on phones (V2): 320×240, 15 fps, ~300 kbps.
// On mobile data it starts smaller still (V3): 240×180, 12 fps, ~150 kbps.
const VIDEO_QUALITY = {
  standard: { width: 320, height: 240, frameRate: 15, maxBitrate: 300_000 },
  cellular: { width: 240, height: 180, frameRate: 12, maxBitrate: 150_000 },
} as const;
type VideoQuality = (typeof VIDEO_QUALITY)[keyof typeof VIDEO_QUALITY];

function videoConstraints(quality: VideoQuality): MediaTrackConstraints {
  return {
    width: { ideal: quality.width },
    height: { ideal: quality.height },
    frameRate: { ideal: quality.frameRate, max: quality.frameRate },
  };
}

/**
 * Whether this device says it's on mobile data (V3). Only the Network
 * Information API can tell, and only some browsers have it (Chrome on
 * Android, the Android app's WebView); elsewhere this is false.
 */
export function onCellular(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return connection?.type === "cellular";
}

// The mobile-data warning is shown once per device.
const CELLULAR_OK_KEY = "luddo-video-cellular-ok";
function cellularAcknowledged() {
  try {
    return localStorage.getItem(CELLULAR_OK_KEY) === "1";
  } catch {
    return false;
  }
}

interface Analysed {
  ctx: AudioContext;
  analyser: AnalyserNode;
}

interface Peer {
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  pendingCandidates: RTCIceCandidateInit[];
}

export interface TableCall {
  joined: boolean;
  connecting: boolean;
  muted: boolean;
  speakingPlayerIds: Set<string>;
  error: string | null;
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
  /** The table permits video at all (V0). When false, the camera button is disabled. */
  videoAvailable: boolean;
  /** This player's own camera is on. */
  cameraOn: boolean;
  /** The camera is starting (permission prompt / device open). */
  cameraStarting: boolean;
  /** This device exposes a second camera to flip to. */
  flipSupported: boolean;
  /** This player's own camera, for a local (mirrored) preview. */
  localVideoStream: MediaStream | null;
  /** Each peer's incoming video, keyed by their player id. */
  remoteVideo: Map<string, MediaStream>;
  /** Quick "hide everyone's video" toggle (audio only, for low data). */
  hideRemoteVideo: boolean;
  /**
   * The one-time mobile-data warning is up (V3): turning the camera on waits
   * until the player accepts it or backs out.
   */
  cellularWarning: boolean;
  acceptCellularWarning: () => void;
  dismissCellularWarning: () => void;
  /** One-tap entry: join the call if needed, then turn the camera on (or off). */
  startVideo: () => void;
  toggleCamera: () => void;
  flipCamera: () => void;
  toggleHideRemoteVideo: () => void;
}

export function useTableCall(client: SupabaseClient, roomId: string): TableCall {
  const myPlayerId = useRoomStore((s) => s.myPlayerId);
  const players = useRoomStore((s) => s.roomState?.players);
  const videoAllowed = useRoomStore((s) => s.roomState?.videoAllowed ?? false);
  const voiceSignals = useRoomStore((s) => s.voiceSignals);
  const consumeVoiceSignal = useRoomStore((s) => s.consumeVoiceSignal);
  const blockedPlayerIds = useRoomStore((s) => s.blockedPlayerIds);

  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [flipSupported, setFlipSupported] = useState(false);
  const [hideRemoteVideo, setHideRemoteVideo] = useState(false);
  const [cellularWarning, setCellularWarning] = useState(false);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<Map<string, MediaStream>>(
    () => new Map(),
  );
  const [speakingPlayerIds, setSpeakingPlayerIds] = useState<Set<string>>(
    () => new Set(),
  );

  const iceServers = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const localStream = useRef<MediaStream | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const earlyCandidates = useRef(new Map<string, RTCIceCandidateInit[]>());
  const analysed = useRef(new Map<string, Analysed>());
  const joinedRef = useRef(false);
  const mutedRef = useRef(false);
  const cameraOnRef = useRef(false);
  // Set when the player asks for video before the call is up (the one-tap
  // "Start video" path): once join completes, the camera turns on by itself.
  const pendingCameraRef = useRef(false);
  const facingMode = useRef<"user" | "environment">("user");
  // Chosen each time the camera opens, so a phone that moves onto Wi-Fi gets
  // the standard size next time.
  const quality = useRef<VideoQuality>(VIDEO_QUALITY.standard);
  // The table permits video, captured in a ref so peer setup (which runs
  // outside React render) sees the current value without re-subscribing.
  const videoAllowedRef = useRef(false);
  // People this player blocked stay connected (so the call works for everyone
  // else) but never receive this player's media, and are never heard.
  const blockedRef = useRef(new Set<string>());

  useEffect(() => {
    videoAllowedRef.current = videoAllowed;
  }, [videoAllowed]);

  const attachAnalyser = useCallback((id: string, stream: MediaStream) => {
    if (stream.getAudioTracks().length === 0) return;
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

  const removeRemoteVideo = useCallback((id: string) => {
    setRemoteVideo((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
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
      removeRemoteVideo(id);
    },
    [detachAnalyser, removeRemoteVideo],
  );

  const sendSignal = useCallback(
    (to: string, signal: WebRtcSignalPayload) => {
      void sendWebrtcSignal(client, roomId, to, signal).catch(() => {
        /* The peer will retry once the next roster/ICE tick fires. */
      });
    },
    [client, roomId],
  );

  // Point a peer's video sender at the camera, unless that peer is blocked.
  const attachVideoSender = useCallback((peer: Peer, id: string, sender: RTCRtpSender) => {
    peer.videoSender = sender;
    const cameraTrack = cameraStream.current?.getVideoTracks()[0] ?? null;
    if (cameraOnRef.current && cameraTrack && !blockedRef.current.has(id)) {
      void sender.replaceTrack(cameraTrack);
      void applyVideoEncoding(sender, quality.current);
    }
  }, []);

  // The answering side of a video table sends on the transceiver the offer
  // created, turned two-way.
  const adoptOfferedVideo = useCallback(
    (peer: Peer, id: string) => {
      if (!videoAllowedRef.current || peer.videoSender) return;
      const transceiver = peer.connection
        .getTransceivers()
        .find((t) => t.receiver.track.kind === "video" && t.currentDirection !== "stopped");
      if (!transceiver) return;
      transceiver.direction = "sendrecv";
      attachVideoSender(peer, id, transceiver.sender);
    },
    [attachVideoSender],
  );

  const ensurePeer = useCallback(
    (id: string, isOfferer: boolean): Peer => {
      const existing = peers.current.get(id);
      if (existing) return existing;

      const connection = new RTCPeerConnection({ iceServers: iceServers.current });
      const audio = new Audio();
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      // Safari is more reliable with MediaStream-backed audio attached to the DOM.
      audio.style.display = "none";
      document.body.appendChild(audio);
      const blocked = blockedRef.current.has(id);
      const peer: Peer = {
        connection,
        audio,
        audioSender: null,
        videoSender: null,
        pendingCandidates: earlyCandidates.current.get(id) ?? [],
      };
      earlyCandidates.current.delete(id);
      peers.current.set(id, peer);

      // ensurePeer only runs after join(), so the mic stream and its audio
      // track are present. Add the track to keep the audio m-line, then drop
      // it for a blocked peer so they never receive this player's audio (V4).
      const audioTrack = localStream.current?.getAudioTracks()[0];
      if (audioTrack && localStream.current) {
        peer.audioSender = connection.addTrack(audioTrack, localStream.current);
        if (blocked) void peer.audioSender.replaceTrack(null);
      }

      // A video transceiver exists only on a video-capable table, so audio-only
      // tables carry no video section (and never trip the server's V0 SDP gate).
      // Only the offerer adds one: an answerer's own addTransceiver is never
      // matched to the offer's video section, so its camera would go out on a
      // sender nobody negotiated. The answerer adopts the offer's instead
      // (adoptOfferedVideo, after setRemoteDescription).
      if (videoAllowedRef.current && isOfferer) {
        const transceiver = connection.addTransceiver("video", {
          direction: "sendrecv",
        });
        attachVideoSender(peer, id, transceiver.sender);
      }

      connection.onicecandidate = (e) => {
        if (e.candidate) sendSignal(id, { type: "ice", candidate: e.candidate.toJSON() });
      };
      connection.ontrack = (e) => {
        if (e.track.kind === "video") {
          const stream = e.streams[0] ?? new MediaStream([e.track]);
          setRemoteVideo((prev) => new Map(prev).set(id, stream));
          e.track.addEventListener("ended", () => removeRemoteVideo(id));
          return;
        }
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        audio.srcObject = stream;
        audio.muted = blockedRef.current.has(id);
        void audio.play().catch(() => {});
        attachAnalyser(id, stream);
      };
      // Report this connection's ICE outcome once (V1), for the failure rate.
      const startedAt = performance.now();
      let reported = false;
      const report = (outcome: IceOutcome, candidateType: CandidateType | null, ms: number) =>
        captureIceOutcome({
          outcome,
          turn_offered: offersTurn(iceServers.current),
          candidate_type: candidateType,
          ms,
          video_table: peer.videoSender !== null,
        });
      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (!reported && (state === "connected" || state === "failed")) {
          reported = true;
          const ms = Math.round(performance.now() - startedAt);
          if (state === "failed") report("failed", null, ms);
          else
            void connection
              .getStats()
              .then((stats) =>
                selectedCandidateType(stats.values() as Iterable<Record<string, unknown>>),
              )
              .catch((): CandidateType => "unknown")
              .then((type) => report("connected", type, ms));
        }
        if (state === "failed" || state === "closed") cleanupPeer(id);
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
    [attachAnalyser, attachVideoSender, cleanupPeer, removeRemoteVideo, sendSignal],
  );

  const stopCamera = useCallback(() => {
    cameraStream.current?.getTracks().forEach((t) => t.stop());
    cameraStream.current = null;
    cameraOnRef.current = false;
    setLocalVideoStream(null);
    setCameraOn(false);
    for (const peer of peers.current.values())
      void peer.videoSender?.replaceTrack(null);
  }, []);

  const leave = useCallback(() => {
    for (const id of Array.from(peers.current.keys())) cleanupPeer(id);
    stopCamera();
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    earlyCandidates.current.clear();
    if (myPlayerId) detachAnalyser(myPlayerId);
    joinedRef.current = false;
    setJoined(false);
    setSpeakingPlayerIds(new Set());
    void leaveVoiceRpc(client, roomId).catch(() => {});
  }, [client, roomId, myPlayerId, cleanupPeer, detachAnalyser, stopCamera]);

  const join = useCallback(() => {
    if (joinedRef.current || connecting) return;
    setError(null);
    // navigator.mediaDevices only exists in a secure context (https or
    // localhost). Over plain http — e.g. a LAN IP on a TV, or an insecure
    // deploy — it's undefined, so guard it rather than throwing
    // "Cannot read properties of undefined (reading 'getUserMedia')".
    const media =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      setError("Voice chat needs a secure (https) connection with microphone support.");
      return;
    }
    setConnecting(true);
    void media
      .getUserMedia({ audio: true })
      .then(async (stream) => {
        stream.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
        localStream.current = stream;
        if (myPlayerId) attachAnalyser(myPlayerId, stream);
        // Fetch a TURN-backed ICE set before any peer is created (V1), so the
        // reconcile effect builds connections that can relay. Best-effort: on
        // failure the ref keeps its STUN-only default.
        iceServers.current = await fetchIceServers(client).catch(
          () => DEFAULT_ICE_SERVERS,
        );
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

  const openCamera = useCallback(async () => {
    const media =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) throw new DOMException("no camera", "NotFoundError");
    quality.current = onCellular() ? VIDEO_QUALITY.cellular : VIDEO_QUALITY.standard;
    const stream = await media.getUserMedia({
      video: { ...videoConstraints(quality.current), facingMode: facingMode.current },
    });
    cameraStream.current = stream;
    const track = stream.getVideoTracks()[0] ?? null;
    // Send the camera to every non-blocked peer within the negotiated envelope.
    for (const [id, peer] of peers.current) {
      if (blockedRef.current.has(id) || !peer.videoSender) continue;
      await peer.videoSender.replaceTrack(track);
      await applyVideoEncoding(peer.videoSender, quality.current);
    }
    // A second camera means flip is worth offering (phones, mostly).
    void media
      .enumerateDevices()
      .then((d) => setFlipSupported(d.filter((x) => x.kind === "videoinput").length > 1))
      .catch(() => {});
    setLocalVideoStream(stream);
    return stream;
  }, []);

  const toggleCamera = useCallback(() => {
    if (cameraStarting) return;
    if (cameraOnRef.current) {
      stopCamera();
      void setCameraOnRpc(client, roomId, false).catch(() => {});
      return;
    }
    if (!joinedRef.current) {
      setError("Join the call before turning on your camera.");
      return;
    }
    if (!videoAllowedRef.current) return;
    // On mobile data, ask once before the camera starts using it.
    if (onCellular() && !cellularAcknowledged()) {
      setCellularWarning(true);
      return;
    }
    setError(null);
    setCameraStarting(true);
    void openCamera()
      .then(async () => {
        cameraOnRef.current = true;
        setCameraOn(true);
        await setCameraOnRpc(client, roomId, true);
      })
      .catch((e) => {
        stopCamera();
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera access was denied."
            : e instanceof Error && e.message.includes("VIDEO_NOT_ALLOWED")
              ? "Video isn't available at this table."
              : "Couldn't turn on your camera.",
        );
      })
      .finally(() => setCameraStarting(false));
  }, [client, roomId, cameraStarting, openCamera, stopCamera]);

  const flipCamera = useCallback(() => {
    if (!cameraOnRef.current || cameraStarting) return;
    facingMode.current = facingMode.current === "user" ? "environment" : "user";
    cameraStream.current?.getTracks().forEach((t) => t.stop());
    setCameraStarting(true);
    void openCamera()
      .catch(() => {
        /* Keep the previous facing if the flip fails; nothing else to do. */
      })
      .finally(() => setCameraStarting(false));
  }, [cameraStarting, openCamera]);

  // One tap to get on camera from cold: join the call if needed, then turn the
  // camera on. The obvious entry point — callers don't have to join voice first.
  const startVideo = useCallback(() => {
    if (cameraOnRef.current) {
      toggleCamera();
      return;
    }
    if (!videoAllowedRef.current) return;
    if (joinedRef.current) {
      toggleCamera();
      return;
    }
    pendingCameraRef.current = true;
    join();
  }, [join, toggleCamera]);

  // Fulfil a "Start video" tap made before the call was up.
  useEffect(() => {
    if (joined && pendingCameraRef.current && !cameraOnRef.current) {
      pendingCameraRef.current = false;
      toggleCamera();
    }
  }, [joined, toggleCamera]);

  const acceptCellularWarning = useCallback(() => {
    try {
      localStorage.setItem(CELLULAR_OK_KEY, "1");
    } catch {
      /* Without storage the warning just comes back next time. */
    }
    setCellularWarning(false);
    toggleCamera();
  }, [toggleCamera]);
  const dismissCellularWarning = useCallback(() => setCellularWarning(false), []);

  const toggleHideRemoteVideo = useCallback(
    () => setHideRemoteVideo((v) => !v),
    [],
  );

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

  // The table stops permitting video mid-call (an under-18 or guest sat down):
  // drop the camera so this player stops sending immediately.
  useEffect(() => {
    if (!videoAllowed && cameraOnRef.current) {
      stopCamera();
      void setCameraOnRpc(client, roomId, false).catch(() => {});
    }
  }, [videoAllowed, client, roomId, stopCamera]);

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
            adoptOfferedVideo(peer, from);
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
  }, [voiceSignals, joined, myPlayerId, ensurePeer, adoptOfferedVideo, sendSignal, consumeVoiceSignal]);

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

  // Block enforced where media is sent (V4): a blocked peer gets both senders
  // set to null (never receives our media) and is muted/hidden locally too.
  useEffect(() => {
    blockedRef.current = new Set(blockedPlayerIds);
    const audioTrack = localStream.current?.getAudioTracks()[0] ?? null;
    const videoTrack = cameraOnRef.current
      ? (cameraStream.current?.getVideoTracks()[0] ?? null)
      : null;
    for (const [id, peer] of peers.current) {
      const blocked = blockedRef.current.has(id);
      // eslint-disable-next-line react-hooks/immutability -- live <audio> elements owned by this hook, not React state.
      peer.audio.muted = blocked;
      void peer.audioSender?.replaceTrack(blocked ? null : audioTrack);
      void peer.videoSender?.replaceTrack(blocked ? null : videoTrack);
    }
  }, [blockedPlayerIds]);

  return {
    joined,
    connecting,
    muted,
    speakingPlayerIds,
    error,
    join,
    leave,
    toggleMute,
    videoAvailable: videoAllowed,
    cameraOn,
    cameraStarting,
    flipSupported,
    localVideoStream,
    remoteVideo,
    hideRemoteVideo,
    cellularWarning,
    acceptCellularWarning,
    dismissCellularWarning,
    startVideo,
    toggleCamera,
    flipCamera,
    toggleHideRemoteVideo,
  };
}

async function applyVideoEncoding(sender: RTCRtpSender, quality: VideoQuality) {
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0)
      params.encodings = [{}];
    params.encodings[0].maxBitrate = quality.maxBitrate;
    params.encodings[0].maxFramerate = quality.frameRate;
    await sender.setParameters(params);
  } catch {
    /* Bitrate capping is best-effort; the call still works without it. */
  }
}
