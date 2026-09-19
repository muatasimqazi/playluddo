"use client";

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { GameRoomState } from "@/lib/board/types";
import { rankPlayers } from "@/lib/board/rules";
import type { MatchEventRow } from "@/lib/realtime/room-channel";
import type { TableMessage } from "@/lib/realtime/table-messages";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { useCountdown } from "@/lib/hooks/useCountdown";
import {
  COLORS,
  HOME_ROTATION,
  type ActionCamera,
  type CameraView,
  type InteractionMode,
  type Quality,
} from "@/lib/presentation/board";
import { PresentationTimeline } from "@/lib/presentation/timeline";
import { Icon, type IconName } from "./Icon";
import "./simulator.css";

const Scene = dynamic(() => import("./SimulatorScene"), {
  ssr: false,
  loading: () => (
    <div className="sim-loading">
      <span />
      <p>Preparing your table</p>
    </div>
  ),
});

export interface SimulatorProps {
  state: GameRoomState;
  events: MatchEventRow[];
  myPlayerId: string | null;
  onRoll: () => Promise<unknown> | void;
  onMove: (id: string) => Promise<unknown> | void;
  onAutoRoll?: (enabled: boolean) => Promise<unknown>;
  pending?: boolean;
  error?: string | null;
  readOnly?: boolean;
  connection?: "connected" | "connecting" | "reconnecting";
  practice?: boolean;
  playerCount?: 2 | 3 | 4;
  onPlayerCountChange?: (count: 2 | 3 | 4) => void;
  messages?: TableMessage[];
  onMessage?: (text: string, kind: "chat" | "reaction") => Promise<unknown>;
  onRestart?: () => void;
  onFlip?: () => void;
  onRematch?: () => Promise<unknown>;
  onReclaim?: () => Promise<unknown>;
  voice?: VoiceChat;
}
interface Preferences {
  quality: Quality;
  sound: boolean;
  music: boolean;
  musicVolume: number;
  actionCamera: ActionCamera;
  orientation: number;
  snakeOrientation: number;
  view: CameraView;
}
const PREF_KEY = "luddo-simulator-v1";
const CAMERA_VIEW_LABELS: Record<CameraView, string> = {
  play: "Seated",
  overhead: "Overhead",
  table: "Full table",
  north: "Across from you",
  west: "Seat to your left",
  east: "Seat to your right",
};
function defaultCameraView(): CameraView {
  if (
    typeof window !== "undefined" &&
    (window.innerWidth <= 900 || window.innerHeight <= 650)
  )
    return "overhead";
  return "play";
}
function loadPreferences(color: keyof typeof COLORS): Preferences {
  const defaults: Preferences = {
    quality:
      typeof window !== "undefined" && window.innerWidth < 700
        ? "medium"
        : "high",
    sound: true,
    music: false,
    musicVolume: 0.3,
    actionCamera: "off",
    orientation: HOME_ROTATION[color],
    snakeOrientation: 0,
    view: defaultCameraView(),
  };
  try {
    const value = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
    if (!value) return defaults;
    return {
      ...defaults,
      quality: ["low", "medium", "high", "ultra"].includes(value.quality)
        ? value.quality
        : defaults.quality,
      sound: typeof value.sound === "boolean" ? value.sound : true,
      music: typeof value.music === "boolean" ? value.music : false,
      musicVolume:
        typeof value.musicVolume === "number" &&
        value.musicVolume >= 0 &&
        value.musicVolume <= 1
          ? value.musicVolume
          : 0.3,
      actionCamera: ["off", "subtle", "cinematic"].includes(value.actionCamera)
        ? value.actionCamera
        : "off",
      // Compact screens begin overhead so the full board remains usable.
      // Camera choices remain available for the current session only.
      view: defaults.view,
      orientation:
        value.localColor === color && Number.isFinite(value.orientation)
          ? value.orientation
          : defaults.orientation,
      snakeOrientation: Number.isFinite(value.snakeOrientation)
        ? value.snakeOrientation
        : 0,
    };
  } catch {
    return defaults;
  }
}

class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="sim-fallback">
        <h2>The 3D table couldn’t load.</h2>
        <p>
          Check hardware acceleration, then reload to reconnect to your match.
        </p>
        <button onClick={() => location.reload()}>Reload table</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function Tool({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`sim-tool ${active ? "is-selected" : ""}`}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

export default function Simulator({
  state,
  events,
  myPlayerId,
  onRoll,
  onMove,
  onAutoRoll,
  pending = false,
  error,
  readOnly = false,
  connection = "connected",
  practice = false,
  playerCount,
  onPlayerCountChange,
  messages = [],
  onMessage,
  onRestart,
  onFlip,
  onRematch,
  onReclaim,
  voice,
}: SimulatorProps) {
  const snakes = state.gameType === "snakes_and_ladders";
  const gameName = snakes ? "Snakes & Ladders" : "Let's Play";
  const [flipping, setFlipping] = useState(false);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(flipTimer.current), []);
  const me = state.players.find((p) => p.id === myPlayerId);
  const progressRanking = rankPlayers(
    state.players.map((player) => {
      const pawns = state.pawns.filter((p) => p.color === player.color);
      return {
        id: player.id,
        pawnsFinished: pawns.filter((p) => p.state === "finished").length,
        totalProgress: pawns.reduce(
          (total, p) => total + (p.pathIndex ?? 0),
          0,
        ),
        turnOrder: player.seatIndex,
      };
    }),
  );
  const ranking =
    state.status === "summary" &&
    state.winnerIds.length === state.players.length
      ? state.winnerIds
      : progressRanking;
  const [prefs, setPrefs] = useState(() =>
    loadPreferences(me?.color ?? "blue"),
  );
  const [mode, setMode] = useState<InteractionMode>("play");
  const [panel, setPanel] = useState<
    "menu" | "camera" | "settings" | "chat" | null
  >(null);
  const [resetKey, setResetKey] = useState(0);
  const [timeline] = useState(() => new PresentationTimeline(state));
  const frame = useSyncExternalStore(
    timeline.subscribe,
    timeline.getSnapshot,
    timeline.getSnapshot,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const backgroundMusic = useRef<HTMLAudioElement>(null);
  const seconds = useCountdown(state.turnDeadlineAt);
  const activePlayer = state.players.find(
    (p) => p.id === (frame.actorId ?? state.turnPlayerId),
  );
  const isMyTurn = state.turnPlayerId === myPlayerId;
  const needsReclaim =
    state.status === "in_game" &&
    !!me &&
    !me.isBot &&
    me.status !== "connected";
  const interactable =
    state.status === "in_game" &&
    !needsReclaim &&
    !panel &&
    !pending &&
    !frame.busy &&
    !flipping &&
    !frame.waitingForEvents &&
    !readOnly &&
    connection === "connected" &&
    mode === "play";
  const canRoll =
    interactable &&
    isMyTurn &&
    state.turnPhase === "awaiting_roll" &&
    !me?.autoRollEnabled;
  const legalPawnIds =
    interactable && isMyTurn && state.turnPhase === "awaiting_move"
      ? state.legalMoves.map((m) => m.pawnId)
      : [];
  useEffect(() => {
    timeline.receive(events, state);
  }, [timeline, events, state]);
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (
      previousConnection.current !== "connected" &&
      connection === "connected"
    ) {
      timeline.reconcileSnapshot(state);
    }
    previousConnection.current = connection;
  }, [connection, state, timeline]);
  useEffect(() => () => timeline.dispose(), [timeline]);
  useEffect(() => {
    try {
      localStorage.setItem(
        PREF_KEY,
        JSON.stringify({
          quality: prefs.quality,
          sound: prefs.sound,
          music: prefs.music,
          musicVolume: prefs.musicVolume,
          actionCamera: prefs.actionCamera,
          orientation: prefs.orientation,
          snakeOrientation: prefs.snakeOrientation,
          localColor: me?.color ?? "blue",
        }),
      );
    } catch {}
  }, [prefs, me?.color]);
  useEffect(() => {
    const audio = new Audio("/audio/background_01.wav");
    audio.loop = true;
    audio.preload = "auto";
    backgroundMusic.current = audio;

    const removeUnlockListeners = () => {
      window.removeEventListener("pointerdown", unlockPlayback);
      window.removeEventListener("keydown", unlockPlayback);
    };
    const play = () => {
      if (audio.muted) return;
      void audio.play().then(removeUnlockListeners).catch(() => {});
    };
    const unlockPlayback = () => play();

    window.addEventListener("pointerdown", unlockPlayback);
    window.addEventListener("keydown", unlockPlayback);
    return () => {
      removeUnlockListeners();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      backgroundMusic.current = null;
    };
  }, []);
  useEffect(() => {
    const audio = backgroundMusic.current;
    if (!audio) return;
    audio.volume = prefs.musicVolume;
    audio.muted = !prefs.music;
    if (prefs.music) void audio.play().catch(() => {});
    else audio.pause();
  }, [prefs.music, prefs.musicVolume]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const playedRoll = useRef(frame.rollId);
  useEffect(() => {
    if (playedRoll.current === frame.rollId) return;
    playedRoll.current = frame.rollId;
    if (!prefs.sound || frame.phase !== "roll") return;
    const sound = new Audio("/sounds/dice-roll.wav");
    sound.volume = 0.45;
    void sound.play().catch(() => {});
    return () => {
      sound.pause();
    };
  }, [frame.rollId, frame.phase, prefs.sound]);
  const setPref = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
      setPrefs((p) => ({ ...p, [key]: value })),
    [setPrefs],
  );
  const reset = useCallback(() => {
    setMode("play");
    setPref("view", defaultCameraView());
    setResetKey((n) => n + 1);
  }, [setPref, setMode, setResetKey]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPanel(null);
        reset();
        timeline.stopReplay();
        return;
      }
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName))
      )
        return;
      if (panel) return;
      if (
        e.code === "Space" &&
        canRoll &&
        !(e.target instanceof HTMLElement && e.target.closest("button"))
      ) {
        e.preventDefault();
        void onRoll();
      }
      if (e.key.toLowerCase() === "l")
        setMode((m) => (m === "look" ? "play" : "look"));
      if (e.key.toLowerCase() === "r")
        setMode((m) => (m === "rotate" ? "play" : "rotate"));
      if (e.key === "1") reset();
      if (e.key === "2") {
        setMode("play");
        setPref("view", "overhead");
      }
      if (e.key === "3") {
        setMode("play");
        setPref("view", "table");
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [canRoll, onRoll, panel, reset, setPref, timeline]);
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setLocalError("Fullscreen is not available in this browser.");
    }
  }
  async function sendMessage(text: string, kind: "chat" | "reaction") {
    if (!text.trim() || !onMessage || sending) return;
    setSending(true);
    setLocalError(null);
    try {
      await onMessage(text.trim(), kind);
      if (kind === "chat") setChat("");
    } catch (e) {
      setLocalError(
        e instanceof Error ? e.message : "Message could not be sent.",
      );
    } finally {
      setSending(false);
    }
  }
  const reactions: Record<string, string> = {};
  messages
    .filter(
      (m) =>
        m.kind === "reaction" && now - new Date(m.createdAt).getTime() < 4500,
    )
    .forEach((m) => {
      reactions[m.playerId] = m.text;
    });
  const title = frame.replaying
    ? "ACTION REPLAY"
    : state.status === "summary" || state.status === "abandoned"
      ? "MATCH COMPLETE"
      : frame.busy
        ? `${activePlayer?.id === myPlayerId ? "You are" : `${activePlayer?.displayName ?? "Player"} is`} ${frame.phase === "roll" ? "rolling" : "moving"}`
        : isMyTurn
          ? "YOUR TURN"
          : `${activePlayer?.displayName ?? "Player"}’S TURN`;
  const instruction =
    mode === "look"
      ? "Drag to look around · Scroll or pinch to zoom"
      : mode === "rotate"
        ? "Drag the board · Release to snap 90°"
        : frame.replaying
          ? "Watching the previous action"
          : frame.waitingForEvents
            ? "Catching up with the table…"
            : frame.busy
              ? frame.phase === "roll"
                ? "The dice are in motion"
                : "Following the move"
              : state.status === "abandoned"
                ? "This match has ended."
                : state.status === "summary"
                  ? `${state.players.find((p) => p.id === state.winnerIds[0])?.displayName ?? "Player"} wins the match`
                  : readOnly
                    ? "This seat is active in another tab"
                    : connection !== "connected"
                      ? "Reconnecting to your table…"
                      : isMyTurn
                        ? state.turnPhase === "awaiting_move"
                          ? `You rolled ${state.activeDiceValue}. Choose a highlighted piece.`
                          : me?.autoRollEnabled
                            ? "Auto-roll is on"
                            : state.rollsThisTurn > 0
                              ? "A little luck. One more roll."
                              : snakes
                                ? "Roll to move · Land exactly on 100 to finish."
                                : "Your next move starts here."
                        : "Settle in. Your turn is coming.";
  const actionLabel = frame.busy
    ? frame.phase === "roll"
      ? "Rolling…"
      : "Moving…"
    : pending
      ? "Sending…"
      : canRoll
        ? state.rollsThisTurn > 0
          ? "Roll again"
          : "Roll dice"
        : legalPawnIds.length
          ? "Select a piece"
          : state.status === "summary"
            ? "Match complete"
            : "Watching the table";
  function togglePanel(value: typeof panel) {
    setPanel((p) => (p === value ? null : value));
  }
  function flipBoard() {
    if (!onFlip || flipping || frame.busy) return;
    setFlipping(true);
    setPanel(null);
    setMode("play");
    onFlip();
    flipTimer.current = setTimeout(() => setFlipping(false), 1600);
  }
  return (
    <main className="simulator" ref={root}>
      <SceneBoundary>
        <Scene
          gameType={state.gameType}
          frame={frame}
          players={state.players}
          myPlayerId={myPlayerId}
          turnPlayerId={state.turnPlayerId}
          legalPawnIds={legalPawnIds}
          canRoll={canRoll}
          view={prefs.view}
          mode={mode}
          orientation={snakes ? prefs.snakeOrientation : prefs.orientation}
          quality={prefs.quality}
          actionCamera={prefs.actionCamera}
          resetKey={resetKey}
          onRotate={(angle) =>
            snakes
              ? setPref("snakeOrientation", angle)
              : setPref("orientation", angle)
          }
          onRoll={() => void onRoll()}
          onMove={(id) => void onMove(id)}
          reactions={reactions}
          speakingPlayerIds={voice?.speakingPlayerIds}
          soundEnabled={prefs.sound}
        />
      </SceneBoundary>
      <div className="sim-vignette" />
      <header className="sim-header">
        <div className="sim-brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            LUDDO<small>{gameName}</small>
          </span>
        </div>
        <div className="sim-turn" role="status">
          <span
            className="live-dot"
            style={{
              background: activePlayer ? COLORS[activePlayer.color] : undefined,
            }}
          />
          <strong>{title}</strong>
          <span className="turn-separator" />
          <span>
            {frame.busy
              ? `ROLLED ${frame.dice}`
              : state.turnPhase === "awaiting_move"
                ? `ROLLED ${state.activeDiceValue}`
                : practice
                  ? "PRACTICE"
                  : "PRIVATE TABLE"}
          </span>
          {seconds !== null &&
            state.status === "in_game" &&
            !frame.replaying &&
            (!frame.busy || frame.actorId === state.turnPlayerId) && (
              <time className={seconds < 6 ? "urgent" : ""}>
                00:{String(seconds).padStart(2, "0")}
              </time>
            )}
        </div>
        <div className="sim-session">
          {onFlip && (
            <Tool
              icon="rotate"
              label={`Flip board to ${snakes ? "Luddo" : "Snakes & Ladders"}`}
              onClick={flipBoard}
              disabled={frame.busy || flipping}
            />
          )}
          <span
            className={`connection-dot ${connection !== "connected" ? "reconnecting" : ""}`}
          />
          {practice
            ? "OFFLINE PRACTICE"
            : connection === "connected"
              ? `ROOM ${state.code}`
              : "RECONNECTING"}
          <Tool
            icon="menu"
            label="Table menu"
            active={panel === "menu"}
            onClick={() => togglePanel("menu")}
          />
        </div>
      </header>
      <nav className="sim-modebar" aria-label="Interaction mode">
        {(
          [
            ["play", "play", "Play", "1"],
            ["look", "look", "Look", "L"],
            ["rotate", "rotate", "Rotate board", "R"],
          ] as const
        ).map(([value, icon, label, key]) => (
          <button
            key={value}
            aria-label={label}
            className={mode === value ? "is-selected" : ""}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setPanel(null);
            }}
          >
            <Icon name={icon} size={16} />
            <span>{label}</span>
            <kbd>{key}</kbd>
          </button>
        ))}
      </nav>
      <aside className="sim-side-tools" aria-label="Table tools">
        <Tool
          icon="camera"
          label="Camera views"
          active={panel === "camera"}
          onClick={() => togglePanel("camera")}
        />
        <Tool icon="home" label="Reset view (1)" onClick={reset} />
        <span className="tool-divider" />
        <Tool
          icon={prefs.sound ? "sound" : "muted"}
          label={prefs.sound ? "Mute sound" : "Enable sound"}
          onClick={() => setPref("sound", !prefs.sound)}
        />
        <Tool
          icon="chat"
          label="Chat and match activity"
          active={panel === "chat"}
          onClick={() => togglePanel("chat")}
        />
        {voice && (
          <>
            <Tool
              icon={voice.joined && !voice.muted ? "mic" : "mic-off"}
              label={
                voice.joined
                  ? voice.muted
                    ? "Unmute microphone"
                    : "Mute microphone"
                  : "Join voice chat"
              }
              active={voice.joined && !voice.muted}
              disabled={voice.connecting}
              onClick={() => (voice.joined ? voice.toggleMute() : voice.join())}
            />
            {voice.joined && (
              <Tool
                icon="phone-off"
                label="Leave voice chat"
                onClick={voice.leave}
              />
            )}
          </>
        )}
        <Tool
          icon="settings"
          label="Settings"
          active={panel === "settings"}
          onClick={() => togglePanel("settings")}
        />
        <Tool
          icon="expand"
          label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={() => void toggleFullscreen()}
        />
      </aside>
      {mode === "rotate" && (
        <div className="sim-rotation">
          <button
            onClick={() =>
              setPref("orientation", prefs.orientation - Math.PI / 2)
            }
            aria-label="Rotate board counterclockwise"
          >
            ↶
          </button>
          <span>
            {((Math.round((prefs.orientation * 180) / Math.PI) % 360) + 360) %
              360}
            °
          </span>
          <button
            onClick={() =>
              setPref("orientation", prefs.orientation + Math.PI / 2)
            }
            aria-label="Rotate board clockwise"
          >
            ↷
          </button>
          <button onClick={() => setMode("play")}>Done</button>
        </div>
      )}
      <footer className="sim-footer">
        <div className="sim-location">
          <span className="eyebrow">Let’s Play </span>
          <strong>
            {snakes ? "SNAKES & LADDERS" : "LUDDO"}{" "}
            <span>{snakes ? "02" : "01"}</span>
          </strong>
          <small>
            {snakes ? "A little luck. A long way up." : "In great company."}
          </small>
        </div>
        <div className="sim-action-area">
          <p aria-live="polite">{instruction}</p>
          <div className="sim-action-row">
            <button
              className="sim-replay"
              onClick={frame.replaying ? timeline.stopReplay : timeline.replay}
              disabled={
                !frame.replaying &&
                (!frame.canReplay || frame.busy || frame.waitingForEvents)
              }
              title="Replay previous action"
            >
              <Icon name="replay" />
              {frame.replaying ? "Live table" : "Replay"}
            </button>
            {mode !== "play" ? (
              <button className="sim-primary" onClick={reset}>
                <Icon name="play" />
                Return to play
              </button>
            ) : (
              <button
                className="sim-primary"
                disabled={!canRoll}
                onClick={() => void onRoll()}
              >
                <Icon name="dice" size={21} />
                {actionLabel}
                {canRoll && <kbd>SPACE</kbd>}
              </button>
            )}
          </div>
          {legalPawnIds.length > 0 && (
            <div
              className="sim-piece-choices"
              aria-label="Choose a legal piece"
            >
              {legalPawnIds.map((id) => (
                <button key={id} onClick={() => void onMove(id)}>
                  Piece {(state.pawns.find((p) => p.id === id)?.index ?? 0) + 1}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sim-view-note">
          <Icon name="camera" size={15} />
          <span>
            {mode === "look"
              ? "Free look"
              : prefs.view === "play"
                ? "Seated view"
                : CAMERA_VIEW_LABELS[prefs.view]}
          </span>
          <small>1 Seated view · 2 Overhead · 3 Table</small>
        </div>
      </footer>
      {(error || localError || voice?.error) && (
        <div className="sim-error" role="alert">
          {error || localError || voice?.error}
          <button
            onClick={() => setLocalError(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      {connection !== "connected" && (
        <div className="sim-connection" role="status">
          Reconnecting · your match is saved
        </div>
      )}
      {needsReclaim && onReclaim && (
        <div className="sim-connection">
          A computer is covering your seat.{" "}
          <button disabled={pending} onClick={() => void onReclaim()}>
            Take back my seat
          </button>
        </div>
      )}
      {panel && (
        <section className="sim-panel" aria-label={`${panel} panel`}>
          <div className="panel-heading">
            <div>
              <span className="eyebrow">AT YOUR TABLE</span>
              <h2>
                {panel === "camera"
                  ? "Find your perspective"
                  : panel === "settings"
                    ? "Make yourself at home"
                    : panel === "chat"
                      ? "Table talk"
                      : "Your evening, your game"}
              </h2>
            </div>
            <Tool
              icon="close"
              label="Close panel"
              onClick={() => setPanel(null)}
            />
          </div>
          {panel === "camera" && (
            <>
              <p>Different perspectives. The same shared board.</p>
              <div className="camera-options">
                {(
                  [
                    ["play", "Seated", "Your place at the table"],
                    ["overhead", "Overhead", "A clear view of every move"],
                    ["table", "Table", "Take in the whole setting"],
                    ["north", "Across from you", "The opposite player’s seat"],
                    ["west", "Seat to your left", "Your left-hand player’s view"],
                    ["east", "Seat to your right", "Your right-hand player’s view"],
                  ] as const
                ).map(([value, label, desc]) => (
                  <button
                    key={value}
                    className={prefs.view === value ? "is-selected" : ""}
                    onClick={() => {
                      setPref("view", value);
                      setMode("play");
                      setPanel(null);
                    }}
                  >
                    <Icon name="camera" />
                    <span>
                      <strong>{label}</strong>
                      <small>{desc}</small>
                    </span>
                    {prefs.view === value && <Icon name="check" size={14} />}
                  </button>
                ))}
              </div>
              <button
                className="panel-secondary"
                onClick={() => {
                  setMode("look");
                  setPanel(null);
                }}
              >
                <Icon name="look" />
                Explore the room
              </button>
            </>
          )}
          {panel === "settings" && (
            <>
              <label className="setting-row">
                <span>
                  Graphics<small>Detail and shadow quality</small>
                </span>
                <select
                  value={prefs.quality}
                  onChange={(e) =>
                    setPref("quality", e.target.value as Quality)
                  }
                >
                  {["low", "medium", "high", "ultra"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-row">
                <span>
                  Action camera<small>Follow meaningful moments</small>
                </span>
                <select
                  value={prefs.actionCamera}
                  onChange={(e) =>
                    setPref("actionCamera", e.target.value as ActionCamera)
                  }
                >
                  {["off", "subtle", "cinematic"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="setting-row">
                <span>
                  Table sounds<small>Dice rolling</small>
                </span>
                <input
                  type="checkbox"
                  checked={prefs.sound}
                  onChange={(e) => setPref("sound", e.target.checked)}
                />
              </label>
              {practice && playerCount && onPlayerCountChange && (
                <label className="setting-row">
                  <span>
                    Players<small>Includes you and computer players</small>
                  </span>
                  <select
                    value={playerCount}
                    onChange={(e) =>
                      onPlayerCountChange(
                        Number(e.target.value) as 2 | 3 | 4,
                      )
                    }
                  >
                    <option value={2}>2 players</option>
                    <option value={3}>3 players</option>
                    <option value={4}>4 players</option>
                  </select>
                </label>
              )}
              <label className="setting-row">
                <span>
                  Background music<small>Ambient table soundtrack</small>
                </span>
                <input
                  type="checkbox"
                  checked={prefs.music}
                  onChange={(e) => setPref("music", e.target.checked)}
                />
              </label>
              <label className="setting-row setting-volume">
                <span>
                  Music volume<small>{Math.round(prefs.musicVolume * 100)}%</small>
                </span>
                <input
                  className="setting-range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={prefs.musicVolume}
                  disabled={!prefs.music}
                  aria-label="Background music volume"
                  onChange={(e) =>
                    setPref("musicVolume", Number(e.target.value))
                  }
                />
              </label>
              {onAutoRoll && (
                <label className="setting-row">
                  <span>
                    Auto-roll<small>Roll when your turn starts</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={me?.autoRollEnabled ?? false}
                    disabled={pending || readOnly}
                    onChange={(e) => void onAutoRoll(e.target.checked)}
                  />
                </label>
              )}
              <button
                className="panel-secondary"
                onClick={() =>
                  snakes
                    ? setPref("snakeOrientation", 0)
                    : setPref("orientation", HOME_ROTATION[me?.color ?? "blue"])
                }
              >
                <Icon name="rotate" />
                {snakes ? "Face square 1" : "Bring my color closer"}
              </button>
              <p className="panel-note">
                Your graphics, sound, music, and board orientation are saved on
                this device. Each game begins in Seated view.
              </p>
            </>
          )}
          {panel === "menu" && (
            <>
              <div className="menu-table">
                <span className="brand-mark">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <div>
                  <strong>{gameName}</strong>
                  <small>
                    {practice
                      ? "Practice against three computers"
                      : `Private table · ${state.code}`}
                  </small>
                </div>
              </div>
              <div className="menu-players">
                {state.players.map((player) => (
                  <div key={player.id}>
                    <PlayerAvatar player={player} size={30} />
                    <span>
                      {player.displayName}
                      {player.id === myPlayerId ? " (you)" : ""}
                    </span>
                    <small>{player.isBot ? "Computer" : player.status}</small>
                  </div>
                ))}
              </div>
              {onFlip && (
                <button
                  className="panel-secondary"
                  onClick={flipBoard}
                  disabled={frame.busy || flipping}
                >
                  <Icon name="rotate" />
                  Flip board · {snakes ? "Luddo" : "Snakes & Ladders"}
                </button>
              )}
              <p className="panel-note">
                {snakes
                  ? "One piece each. Roll to move automatically. Climb ladders, slide down snakes, and land exactly on 100. Sixes do not grant extra turns. Everyone plays for a place."
                  : "Roll a six to enter. Bring all four pieces home; completed players sit out while the others finish."}
                {practice &&
                  " Each side keeps its own practice progress when you flip."}
              </p>
              {onRestart && (
                <button className="panel-secondary" onClick={onRestart}>
                  <Icon name="replay" />
                  Start a fresh practice
                </button>
              )}
              <Link href="/" className="panel-secondary">
                <Icon name="home" />
                Back to the entrance
              </Link>
              <p className="panel-note">
                Space rolls the die. L explores the room. R rotates the board.
                Escape returns to play.
              </p>
            </>
          )}
          {panel === "chat" && (
            <>
              <div className="chat-content">
                {practice && (
                  <p className="panel-note">
                    You’re playing offline. Invite friends to a private table
                    for live conversation.
                  </p>
                )}
                {messages
                  .filter((m) => m.kind === "chat")
                  .map((message) => (
                    <div className="chat-message" key={message.id}>
                      <strong
                        style={{
                          color:
                            COLORS[
                              state.players.find(
                                (p) => p.id === message.playerId,
                              )?.color ?? "blue"
                            ],
                        }}
                      >
                        {state.players.find((p) => p.id === message.playerId)
                          ?.displayName ?? "Player"}
                      </strong>
                      <p>{message.text}</p>
                    </div>
                  ))}
                <span className="eyebrow">MATCH ACTIVITY</span>
                {events
                  .slice(-12)
                  .reverse()
                  .map((e) => (
                    <div key={e.id} className="activity-line">
                      <span>
                        {state.players.find((p) => p.id === e.player_id)
                          ?.displayName ?? "Table"}
                      </span>
                      <p>
                        {e.event_type === "dice_rolled"
                          ? `rolled ${e.payload.dieValue}${e.payload.overshoot ? " · exact roll needed, stays put" : e.payload.cancelledByThirdSix ? " · third six, turn ends" : ""}`
                          : e.event_type === "legal_move_selected"
                            ? snakes
                              ? e.payload.finishesPawn
                                ? "reached 100"
                                : `moved to square ${String(e.payload.toTileId).split(":")[1]}`
                              : e.payload.finishesPawn
                                ? "brought a piece home"
                                : Array.isArray(e.payload.capturesPawnIds) &&
                                    e.payload.capturesPawnIds.length
                                  ? "captured a piece"
                                  : "moved a piece"
                            : e.event_type.replaceAll("_", " ")}
                      </p>
                    </div>
                  ))}
                {!events.length && !messages.length && (
                  <p className="panel-note">
                    The table is ready. Make the first move.
                  </p>
                )}
              </div>
              {onMessage && (
                <>
                  <div className="reaction-picker">
                    {["👋", "👏", "🎲", "😅", "🔥", "💛"].map((emoji) => (
                      <button
                        key={emoji}
                        disabled={sending}
                        aria-label={`React ${emoji}`}
                        onClick={() => void sendMessage(emoji, "reaction")}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <form
                    className="chat-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void sendMessage(chat, "chat");
                    }}
                  >
                    <input
                      aria-label="Message the table"
                      placeholder="Say something to the table…"
                      maxLength={240}
                      value={chat}
                      onChange={(e) => setChat(e.target.value)}
                    />
                    <button
                      disabled={sending || !chat.trim()}
                      aria-label="Send message"
                    >
                      <Icon name="arrow" />
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </section>
      )}
      {(state.status === "summary" || state.status === "abandoned") &&
        !frame.busy &&
        frame.pawns.every(
          (p) =>
            state.pawns.find((s) => s.id === p.id)?.pathIndex === p.pathIndex,
        ) && (
          <div className="sim-victory">
            {state.status !== "abandoned" &&
              state.players.find((p) => p.id === state.winnerIds[0]) && (
                <PlayerAvatar
                  player={state.players.find((p) => p.id === state.winnerIds[0])!}
                  size={76}
                  crowned
                />
              )}
            <span className="eyebrow">
              {state.status === "abandoned" ? "UNTIL NEXT TIME" : "WELL PLAYED"}
            </span>
            <h1>
              {state.status === "abandoned"
                ? "The table is quiet."
                : `${state.players.find((p) => p.id === state.winnerIds[0])?.displayName ?? "Player"} wins.`}
            </h1>
            <p>
              {state.status === "abandoned"
                ? "The match ended when everyone left."
                : snakes
                  ? "One hundred squares. One lovely game."
                  : "Four pieces home. One lovely game."}
            </p>
            <div className="menu-players">
              {[...state.players]
                .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id))
                .map((p, index) => (
                  <div key={p.id}>
                    <PlayerAvatar
                      player={p}
                      size={30}
                      placement={index < 3 ? ((index + 1) as 1 | 2 | 3) : undefined}
                    />
                    <span>{p.displayName}</span>
                    <small>
                      {snakes ? (
                        `${state.pawns.find((piece) => piece.color === p.color)?.pathIndex ?? 0}/100`
                      ) : (
                        <>
                          {
                            state.pawns.filter(
                              (piece) =>
                                piece.color === p.color &&
                                piece.state === "finished",
                            ).length
                          }
                          /4 home
                        </>
                      )}
                    </small>
                  </div>
                ))}
            </div>
            {onRestart && (
              <button className="sim-primary" onClick={onRestart}>
                Play another round
                <Icon name="arrow" />
              </button>
            )}
            {onRematch && state.status === "summary" && (
              <button
                className="sim-primary"
                disabled={pending || me?.rematchReady}
                onClick={() => void onRematch()}
              >
                {me?.rematchReady
                  ? "Waiting for the table…"
                  : state.players.some((p) => p.rematchReady)
                    ? "Accept rematch"
                    : "Play another round"}
                <Icon name="arrow" />
              </button>
            )}
            <Link className="panel-secondary" href="/">
              Back to the entrance
            </Link>
          </div>
        )}
      {frame.move?.finishesPawn && frame.phase === "move" && (
        <div className="sim-event-toast">
          {snakes
            ? "100! A place at the finish."
            : "A little closer. A piece is home."}
        </div>
      )}
      {snakes &&
        frame.phase === "move" &&
        frame.move?.landingSquare !== undefined &&
        Number(frame.move.toTileId.split(":")[1]) !==
          frame.move.landingSquare && (
          <div className="sim-event-toast">
            {Number(frame.move.toTileId.split(":")[1]) >
            frame.move.landingSquare
              ? "Up the ladder"
              : "Down the snake"}
            {` · ${frame.move.landingSquare} → ${frame.move.toTileId.split(":")[1]}`}
          </div>
        )}
    </main>
  );
}
