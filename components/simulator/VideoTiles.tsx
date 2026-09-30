"use client";

import { useEffect, useRef, useState } from "react";
import type { Player } from "@/lib/board/types";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import { Icon } from "./Icon";

/**
 * The 2D fallback for video chat (Section 7, V3): a strip of camera tiles above
 * the controls, shown on small screens or wherever the 3D VideoTexture isn't in
 * play. Local preview is mirrored; each remote tile carries report, block and
 * enlarge (V4: safety controls sit on the video itself).
 * Blocked seats and "hide everyone's video" drop tiles here, and the hook also
 * stops sending/receiving their media, so this is presentation only.
 */
export function VideoTiles({
  call,
  players,
  myPlayerId,
  blockedPlayerIds,
  onBlockPlayer,
  onReportPlayer,
}: {
  call: VoiceChat;
  players: Player[];
  myPlayerId: string | null;
  blockedPlayerIds: string[];
  onBlockPlayer?: (playerId: string, blocked: boolean) => Promise<unknown>;
  /** Open the table's report form for this player. */
  onReportPlayer?: (playerId: string) => void;
}) {
  const [enlargedId, setEnlargedId] = useState<string | null>(null);

  if (!call.joined) return null;

  const blocked = new Set(blockedPlayerIds);
  const me = players.find((p) => p.id === myPlayerId);
  const remotes = call.hideRemoteVideo
    ? []
    : players.filter(
        (p) =>
          p.id !== myPlayerId &&
          p.cameraOn &&
          !p.isBot &&
          !blocked.has(p.id) &&
          call.remoteVideo.has(p.id),
      );

  const enlarged =
    enlargedId === myPlayerId
      ? { player: me, stream: call.localVideoStream, mine: true }
      : (() => {
          const p = remotes.find((r) => r.id === enlargedId);
          return p ? { player: p, stream: call.remoteVideo.get(p.id) ?? null, mine: false } : null;
        })();

  // Report and block for a remote tile. Blocking closes an enlarged view, as
  // that player's tile disappears.
  const safety = (id: string) => ({
    onReport: onReportPlayer
      ? () => {
          setEnlargedId(null);
          onReportPlayer(id);
        }
      : undefined,
    onBlock: onBlockPlayer
      ? () => {
          setEnlargedId(null);
          void onBlockPlayer(id, true);
        }
      : undefined,
  });

  const hasTiles = (call.cameraOn && call.localVideoStream) || remotes.length > 0;

  return (
    <div className="video-chat">
      <div className="video-controls" role="group" aria-label="Video chat">
        <button
          type="button"
          className={`video-btn ${call.cameraOn ? "is-active" : ""}`}
          disabled={call.cameraStarting || (!call.cameraOn && !call.videoAvailable)}
          title={
            call.videoAvailable
              ? call.cameraOn
                ? "Turn off your camera"
                : "Turn on your camera"
              : "Video isn't available at this table"
          }
          aria-label={
            call.videoAvailable
              ? call.cameraOn
                ? "Turn off your camera"
                : "Turn on your camera"
              : "Video isn't available at this table"
          }
          onClick={call.toggleCamera}
        >
          <Icon name="camera" />
        </button>
        {call.cameraOn && call.flipSupported && (
          <button
            type="button"
            className="video-btn"
            disabled={call.cameraStarting}
            title="Flip camera"
            aria-label="Flip camera"
            onClick={call.flipCamera}
          >
            <Icon name="swap" />
          </button>
        )}
        <button
          type="button"
          className={`video-btn ${call.hideRemoteVideo ? "is-active" : ""}`}
          title={call.hideRemoteVideo ? "Show everyone's video" : "Hide everyone's video"}
          aria-label={call.hideRemoteVideo ? "Show everyone's video" : "Hide everyone's video"}
          onClick={call.toggleHideRemoteVideo}
        >
          <Icon name="eye-off" />
        </button>
      </div>

      {hasTiles && (
        <div className="video-strip">
          {call.cameraOn && call.localVideoStream && (
            <VideoTile
              stream={call.localVideoStream}
              name={me?.displayName ?? "You"}
              mine
              onEnlarge={() => setEnlargedId(myPlayerId)}
            />
          )}
          {remotes.map((p) => (
            <VideoTile
              key={p.id}
              stream={call.remoteVideo.get(p.id) ?? null}
              name={p.displayName}
              onEnlarge={() => setEnlargedId(p.id)}
              {...safety(p.id)}
            />
          ))}
        </div>
      )}

      {enlarged?.player && (
        <div
          className="video-enlarged"
          role="dialog"
          aria-label={`${enlarged.player.displayName}'s video`}
          onClick={() => setEnlargedId(null)}
        >
          <div className="video-enlarged-inner" onClick={(e) => e.stopPropagation()}>
            <VideoTile
              stream={enlarged.stream}
              name={enlarged.player.displayName}
              mine={enlarged.mine}
              large
              {...(enlarged.mine ? {} : safety(enlarged.player.id))}
            />
            <button
              type="button"
              className="video-btn video-enlarged-close"
              aria-label="Close"
              onClick={() => setEnlargedId(null)}
            >
              <Icon name="close" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoTile({
  stream,
  name,
  mine,
  large,
  onEnlarge,
  onReport,
  onBlock,
}: {
  stream: MediaStream | null;
  name: string;
  mine?: boolean;
  large?: boolean;
  onEnlarge?: () => void;
  onReport?: () => void;
  onBlock?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);

  return (
    <div className={`video-tile ${large ? "is-large" : ""} ${mine ? "is-mine" : ""}`}>
      <video
        ref={ref}
        autoPlay
        playsInline
        // Never play your own mic back to yourself; remote audio rides the call's <audio> elements.
        muted
        onClick={onEnlarge}
      />
      <span className="video-tile-name">{mine ? `${name} (you)` : name}</span>
      {(onReport || onBlock) && (
        <div className="video-tile-safety">
          {onReport && (
            <button
              type="button"
              className="video-tile-report"
              title={`Report ${name}`}
              aria-label={`Report ${name}`}
              onClick={onReport}
            >
              <Icon name="flag" size={14} />
            </button>
          )}
          {onBlock && (
            <button
              type="button"
              className="video-tile-block"
              title={`Block ${name}`}
              aria-label={`Block ${name}`}
              onClick={onBlock}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
