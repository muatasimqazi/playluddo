"use client";

import { useEffect, useRef } from "react";
import type { Player } from "@/lib/board/types";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import { Icon } from "./Icon";

/**
 * Video chat's controls, your own mirrored preview, and the 2D fallback for
 * everyone else's camera (Section 7, V3): a strip of tiles above the controls
 * on small screens, or when the table drops out of 3D video because the frame
 * rate fell. On a larger screen the remote cameras sit on the 3D seat figures
 * instead (`remoteInScene`), and tapping one opens the same enlarged view.
 * Each remote tile and the enlarged view carry report and block (V4: safety
 * controls sit on the video itself).
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
  remoteInScene = false,
  enlargedId,
  onEnlarge,
}: {
  call: VoiceChat;
  players: Player[];
  myPlayerId: string | null;
  blockedPlayerIds: string[];
  onBlockPlayer?: (playerId: string, blocked: boolean) => Promise<unknown>;
  /** Open the table's report form for this player. */
  onReportPlayer?: (playerId: string) => void;
  /** Remote cameras are on the 3D seat figures, so the strip leaves them out. */
  remoteInScene?: boolean;
  /** Whose video is shown large; null for none. Owned by the table so a tap on a seat figure can open it. */
  enlargedId: string | null;
  onEnlarge: (playerId: string | null) => void;
}) {
  const setEnlargedId = onEnlarge;

  if (call.cellularWarning) return <CellularNotice call={call} />;
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

  const hasTiles =
    (call.cameraOn && call.localVideoStream) || (!remoteInScene && remotes.length > 0);

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
          {!remoteInScene && remotes.map((p) => (
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
    if (!stream) return;
    void el.play().catch(() => {});
    // A tile scrolled out of the strip stops drawing frames until it's back.
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void el.play().catch(() => {});
      else el.pause();
    });
    observer.observe(el);
    return () => observer.disconnect();
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

/**
 * The one-time mobile-data warning (V3), shown before the camera starts on a
 * phone the browser reports is on mobile data.
 */
function CellularNotice({ call }: { call: VoiceChat }) {
  return (
    <div className="sim-dialog-backdrop" role="presentation" onMouseDown={call.dismissCellularWarning}>
      <section
        className="sim-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cellular-title"
        aria-describedby="cellular-body"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="eyebrow">VIDEO</span>
        <h2 id="cellular-title">You&rsquo;re on mobile data</h2>
        <p id="cellular-body">
          Video uses about 3 MB a minute for each other person on camera. We&rsquo;ll send yours
          at a lower quality to save data, and you can hide everyone&rsquo;s video any time to keep
          just voice.
        </p>
        <div className="sim-dialog-actions">
          <button className="sim-primary" autoFocus onClick={call.acceptCellularWarning}>
            <Icon name="camera" />
            Turn on camera
          </button>
          <button className="panel-secondary" onClick={call.dismissCellularWarning}>
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}
