"use client";

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { GameRoomState, MatchStats, MatchResult } from "@/lib/board/types";
import { DEFAULT_ROOM_RULES, rankPlayers, resolveRoomRules, teamColors } from "@/lib/board/rules";
import type { MatchEventRow } from "@/lib/realtime/room-channel";
import type { TableMessage } from "@/lib/realtime/table-messages";
import { REPORT_REASONS, type ReportReason } from "@/lib/supabase/moderation";
import type { VoiceChat } from "@/lib/hooks/useVoiceChat";
import type { Cast } from "@/lib/hooks/useCast";
import { canCast, toggleCast, useCastLabel } from "@/components/cast/CastButton";
import { PlayerAvatar } from "@/components/shared/PlayerAvatar";
import { PlayerProfileButton, PlayerProfileDialog } from "@/components/profile/PlayerProfileButton";
import { MatchDice } from "@/components/summary/MatchDice";
import { LudoRules, OnlineTableRules, SnakesRules } from "@/components/site/GameRules";
import { FirstGameTips } from "./FirstGameTips";
import { REACTION_EMOJI_ROWS, REACTION_PHRASES, REVENGE } from "@/lib/realtime/reactions";
import { clock, describeMove, forcedMovePawnId, partyWaitEndsAt } from "@/lib/presentation/controller";
import { useAdaptiveQuality } from "@/lib/hooks/useAdaptiveQuality";
import type { DiceProof } from "@/lib/presentation/diceProof";
import { useCountdown } from "@/lib/hooks/useCountdown";
import { mirrorGameCenterOnlineResults } from "@/lib/gameCenter";
import { playSoundEffect, preloadSoundEffects } from "@/lib/sound/effects";
import {
  COLORS,
  homeRotation,
  rotationStep,
  type ActionCamera,
  type CameraView,
  type InteractionMode,
  type Quality,
} from "@/lib/presentation/board";
import { BOARD_4, boardSpecForPawns, type BoardSpec } from "@/lib/board/boardSpec";
import { PresentationTimeline } from "@/lib/presentation/timeline";
import {
  DEFAULT_BOARD_STYLE,
  SIMULATOR_PREF_KEY,
  type BoardStyle,
} from "@/lib/presentation/simulatorPrefs";
import {
  boardCosmetic,
  boardStyleForCosmetic,
  ownedRoom,
  roomCosmetic,
} from "@/lib/presentation/cosmeticGates";
import { useCosmeticOwnership } from "@/lib/hooks/useCosmeticOwnership";
import { gamePreferences, isSignedIn } from "@/lib/preferences";
import { createClient } from "@/lib/supabase/client";
import { equipCosmetic, getMyCosmetics, type EquippedCosmetics } from "@/lib/supabase/cosmetics";
import { useGamePreference } from "@/lib/preferences-react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";
import { seatColors } from "@/lib/presentation/accessibility";
import {
  announceEnd,
  announceEvent,
  announceTurn,
  describePieceChoice,
} from "@/lib/presentation/announcements";
import { SeatSymbol } from "@/components/shared/SeatSymbol";
import { Icon, type IconName } from "./Icon";
import { VideoTiles } from "./VideoTiles";
import { TableLoading } from "./TableLoading";
import { BRAND } from "@/lib/brand";
import { webUrl } from "@/lib/native";
import "./simulator.css";

const Scene = dynamic(() => import("./SimulatorScene"), {
  ssr: false,
  loading: () => <TableLoading label="Preparing your table" progress={null} />,
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
  localPlay?: boolean;
  playerCount?: 2 | 3 | 4;
  onPlayerCountChange?: (count: 2 | 3 | 4) => void;
  messages?: TableMessage[];
  onMessage?: (text: string, kind: "chat" | "reaction") => Promise<unknown>;
  onRestart?: () => void;
  /**
   * Take back your last move (docs/COMPETITIVE_ROADMAP.md F4.5). Offline only —
   * practice and Table Together pass this; online play never does.
   */
  onUndo?: () => void;
  canUndo?: boolean;
  /**
   * Watching live tables (docs/COMPETITIVE_ROADMAP.md F4.4): the host opens the
   * table to watchers, any seated human closes it. Online, non-party rooms only.
   */
  onSetWatching?: (enabled: boolean) => Promise<unknown> | void;
  onFlip?: () => void;
  onRematch?: () => Promise<unknown>;
  onReclaim?: () => Promise<unknown>;
  paused?: boolean;
  canPause?: boolean;
  onPause?: (paused: boolean) => Promise<unknown> | void;
  voice?: VoiceChat;
  /** Seats whose chat, reactions and voice this player has blocked. */
  blockedPlayerIds?: string[];
  onBlockPlayer?: (playerId: string, blocked: boolean) => Promise<unknown>;
  onReportPlayer?: (playerId: string, reason: ReportReason, details: string) => Promise<unknown>;
  /** Every seat's result once an online match ends; absent offline. */
  matchResults?: MatchResult[] | null;
  /** The ended match's dice proof, for "Check the dice"; absent offline. */
  diceProof?: DiceProof | null;
  /**
   * Party Mode's shared screen (docs/COMPETITIVE_ROADMAP.md P4): nobody sits
   * here, so the whole table is in one steady view, text is
   * sized for a sofa, controls are hidden and quality adapts to the device.
   */
  screen?: boolean;
  /** Screen only: the piece the player whose move it is has picked on their phone. */
  previewPawnId?: string | null;
  /** Cast to TV: show this online table on a TV while playing here. */
  cast?: Cast;
}

// The scene's own "compact" test (SimulatorScene: width <= 900 or height <= 650).
const COMPACT_QUERY = "(max-width: 900px), (max-height: 650px)";
function subscribeCompact(onChange: () => void) {
  const media = window.matchMedia(COMPACT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Picking a board or room at the table also equips it (F3.5), so the
 * profile's cosmetics locker shows the same choice. Best effort: the table
 * already shows the pick, and a guest without a session just keeps it here.
 */
function mirrorEquip(cosmeticId: string) {
  void equipCosmetic(createClient(), cosmeticId).catch(() => {});
}

/** One short line per player on the victory panel. */
function statsLine(stats: MatchStats, snakes: boolean) {
  const parts = snakes
    ? [plural(stats.sixes, "six", "sixes"), plural(stats.turns, "turn")]
    : [
        plural(stats.capturesMade, "capture"),
        plural(stats.sixes, "six", "sixes"),
        plural(stats.turns, "turn"),
      ];
  if (stats.missedDecisions > 0) parts.push(`${stats.missedDecisions} timed out`);
  return parts.join(" · ");
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
  boardStyle: BoardStyle;
  immersive: boolean;
  brightness: number;
  saturation: number;
}
const PREF_KEY = SIMULATOR_PREF_KEY;
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
function loadPreferences(color: keyof typeof COLORS, spec: BoardSpec = BOARD_4): Preferences {
  const defaults: Preferences = {
    quality:
      typeof window !== "undefined" && window.innerWidth < 700
        ? "medium"
        : "high",
    sound: true,
    music: false,
    musicVolume: 0.3,
    actionCamera: "off",
    orientation: homeRotation(color, spec),
    snakeOrientation: 0,
    view: defaultCameraView(),
    boardStyle: "classic",
    immersive: false,
    brightness: 1,
    saturation: 1,
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
      // A saved angle only fits the same seat on the same board: red on the
      // cross and red on the hexagon are turned differently. Saves from
      // before the hexagon have no localArms and were all on the cross.
      orientation:
        value.localColor === color &&
        (value.localArms ?? 4) === spec.arms &&
        Number.isFinite(value.orientation)
          ? value.orientation
          : defaults.orientation,
      snakeOrientation: Number.isFinite(value.snakeOrientation)
        ? value.snakeOrientation
        : 0,
      boardStyle: ["signature", "classic", "geometric", "aladdin"].includes(
        value.boardStyle,
      )
        ? value.boardStyle
        : "classic",
      // Session-only, like view — reopening the table should never come
      // back with everything mysteriously hidden.
      immersive: defaults.immersive,
      brightness:
        typeof value.brightness === "number" &&
        value.brightness >= 0.6 &&
        value.brightness <= 1.6
          ? value.brightness
          : defaults.brightness,
      saturation:
        typeof value.saturation === "number" &&
        value.saturation >= 0 &&
        value.saturation <= 2
          ? value.saturation
          : defaults.saturation,
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
  danger = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`sim-tool ${active ? "is-selected" : ""} ${danger ? "is-danger" : ""}`}
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
  localPlay = false,
  playerCount,
  onPlayerCountChange,
  messages = [],
  onMessage,
  onRestart,
  onUndo,
  canUndo = false,
  onSetWatching,
  onFlip,
  onRematch,
  onReclaim,
  paused = false,
  canPause = false,
  onPause,
  voice,
  blockedPlayerIds = [],
  onBlockPlayer,
  onReportPlayer,
  matchResults,
  diceProof,
  screen = false,
  previewPawnId = null,
  cast: castProp,
}: SimulatorProps) {
  // The shared screen is the TV itself; it never casts.
  const cast = screen ? undefined : castProp;
  const castLabel = useCastLabel(cast);
  const snakes = state.gameType === "snakes_and_ladders";
  // Seats only have profiles at an online table: practice and Table Together
  // seats are local, and the shared TV screen is nobody's to tap.
  const profiles = !practice && !localPlay && !screen;
  const [profileSeat, setProfileSeat] = useState<string | null>(null);
  const profilePlayer = profileSeat ? state.players.find((p) => p.id === profileSeat) : undefined;
  const gameName = snakes ? "Snakes & Ladders" : BRAND.gameName;
  const [flipping, setFlipping] = useState(false);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(flipTimer.current), []);
  const me = state.players.find((p) => p.id === myPlayerId);
  // Online, every seat's equipped cosmetics ride in the room state (F3.5).
  // Offline seats carry none, so a signed-in player's own equipped die and
  // pieces are fetched once and put on their seat for the scene: practice
  // looks the same as their online games.
  const offlineSeat = me !== undefined && me.cosmetics === undefined;
  const [myLoadout, setMyLoadout] = useState<EquippedCosmetics | null>(null);
  useEffect(() => {
    if (!offlineSeat) return;
    let cancelled = false;
    void (async () => {
      try {
        const client = createClient();
        const { data } = await client.auth.getUser();
        if (!isSignedIn(data.user)) return;
        const loadout: EquippedCosmetics = {};
        for (const item of await getMyCosmetics(client)) {
          if (item.equipped && (item.type === "dice" || item.type === "piece"))
            loadout[item.type] = item.id;
        }
        if (!cancelled) setMyLoadout(loadout);
      } catch {
        /* Offline or signed out: the classic die and the board's own pieces. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offlineSeat]);
  const scenePlayers = useMemo(
    () =>
      offlineSeat && myLoadout
        ? state.players.map((p) =>
            p.id === myPlayerId ? { ...p, cosmetics: myLoadout } : p,
          )
        : state.players,
    [offlineSeat, myLoadout, state.players, myPlayerId],
  );
  // The 5-6 player hexagon or the 4-arm cross (F5.2), from the seat colours.
  const boardSpec = boardSpecForPawns(state.players);
  // "Revenge!" is on offer once someone captures one of my pieces, until I
  // next move.
  const revengeReady = (() => {
    if (!me) return false;
    const mine = new Set(state.pawns.filter((p) => p.color === me.color).map((p) => p.id));
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.event_type !== "legal_move_selected") continue;
      if (event.player_id === me.id) return false;
      const captured = event.payload?.capturesPawnIds;
      if (Array.isArray(captured) && captured.some((id) => mine.has(String(id)))) return true;
    }
    return false;
  })();
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
  const winner = state.players.find((p) => p.id === state.winnerIds[0]);
  // Team Up (F2.5) results: each pair's eight pieces counted together, the
  // pair holding first place on top (or, if the table emptied, the pair
  // furthest along).
  const teams =
    !snakes && resolveRoomRules(state.rules).teamUp
      ? (["red", "green"] as const)
          .map((lead) => {
            const colors = teamColors(lead, true);
            const pieces = state.pawns.filter((p) => colors.has(p.color));
            return {
              lead,
              members: state.players.filter((p) => colors.has(p.color)),
              finished: pieces.filter((p) => p.state === "finished").length,
              progress: pieces.reduce((sum, p) => sum + (p.pathIndex ?? 0), 0),
              won: !!winner && colors.has(winner.color),
            };
          })
          .sort(
            (a, b) =>
              Number(b.won) - Number(a.won) ||
              b.finished - a.finished ||
              b.progress - a.progress,
          )
      : null;
  const teamName = (team: { members: { displayName: string }[] }) =>
    team.members.map((m) => m.displayName).join(" & ");
  // The Party screen holds one steady view: an action camera would swing it
  // out and back on every roll and move, which reads as the TV lurching
  // around for the people watching it from across the room.
  const [prefs, setPrefs] = useState(() =>
    screen
      ? { ...loadPreferences("blue", boardSpec), view: "table" as const, actionCamera: "off" as const, immersive: false }
      : loadPreferences(me?.color ?? "blue", boardSpec),
  );
  // Boards and rooms are earned (F3.5): the table draws the chosen one only
  // if the account owns it, falling back to its equipped board, then the
  // free default.
  const ownership = useCosmeticOwnership();
  const equippedBoard = me?.cosmetics?.board
    ? boardStyleForCosmetic(me.cosmetics.board)
    : undefined;
  const effectiveBoardStyle: BoardStyle = ownership.owns(boardCosmetic(prefs.boardStyle))
    ? prefs.boardStyle
    : (equippedBoard ?? DEFAULT_BOARD_STYLE);
  const screenQuality = useAdaptiveQuality(screen);
  // Accessibility (F5.5): follow the player across devices like board style.
  const [colorBlind, setColorBlind] = useGamePreference("colorBlind");
  const [reduceMotion, setReduceMotion] = useGamePreference("reduceMotion");
  // The room around the table follows the player across devices too.
  const [room, setRoom] = useGamePreference("room");
  const effectiveRoom = ownedRoom(room, ownership.owns);
  const reducedMotion = useReducedMotion();
  const palette = seatColors(colorBlind);
  // Video (Section 7, V3): remote cameras sit on cards above the seat figures
  // on a larger screen, and in the 2D strip on a phone or once the frame rate
  // has dropped with them up (for the rest of this visit).
  const compactScreen = useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  );
  const [videoSlow, setVideoSlow] = useState(false);
  const [enlargedVideoId, setEnlargedVideoId] = useState<string | null>(null);
  const [mode, setMode] = useState<InteractionMode>("play");
  const [leaving, setLeaving] = useState(false);
  const [panel, setPanel] = useState<
    "menu" | "camera" | "board" | "preferences" | "chat" | "help" | null
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
  // Report form for one player at a time (chat panel).
  const [reporting, setReporting] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("harassment");
  const [reportDetails, setReportDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [moderating, setModerating] = useState(false);
  const [moderationNote, setModerationNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [reactionTab, setReactionTab] = useState<"emoji" | "phrases">("emoji");
  const [now, setNow] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const backgroundMusic = useRef<HTMLAudioElement>(null);
  // Keyboard play (F5.5): whether the last input was a key, so focus is only
  // moved for keyboard users and never jumps around under a finger or mouse.
  const keyboardUser = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["Tab", "Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
        keyboardUser.current = true;
    };
    const onPointer = () => {
      keyboardUser.current = false;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);
  const rollButton = useRef<HTMLButtonElement>(null);
  const pieceChoices = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelOpener = useRef<HTMLElement | null>(null);
  // The piece focused in the keyboard piece list, lifted on the board.
  const [focusedPawnId, setFocusedPawnId] = useState<string | null>(null);
  // Screen-reader announcements (F5.5): the last few lines of a polite log.
  const [announcements, setAnnouncements] = useState<{ id: number; text: string }[]>([]);
  const announcementId = useRef(0);
  const announce = useCallback((text: string | null) => {
    if (!text) return;
    announcementId.current += 1;
    const id = announcementId.current;
    setAnnouncements((list) => [...list.slice(-4), { id, text }]);
  }, []);
  const seconds = useCountdown(state.turnDeadlineAt);
  // Rush mode (F2.3): the match clock, if this match has one.
  const matchLeft = useCountdown(state.status === "in_game" && !paused ? (state.matchEndsAt ?? null) : null);
  const playedFinalCall = useRef(false);
  useEffect(() => {
    if (matchLeft === null || matchLeft > 30) {
      playedFinalCall.current = false;
      return;
    }
    if (playedFinalCall.current || !prefs.sound) return;
    playedFinalCall.current = true;
    return playSoundEffect("diceSix", 0.5);
  }, [matchLeft, prefs.sound]);
  // Party Mode (P5): the phone the table is waiting for, and how long it has.
  const waitingFor = state.players.find((p) => p.id === state.pausedForPlayerId);
  const waitLeft = useCountdown(partyWaitEndsAt(state));
  // The board's turn, not the room's: it waits for the events that passed
  // the turn on, so the turn bar moves with the die (see the timeline).
  const activePlayer = state.players.find(
    (p) => p.id === (frame.actorId ?? frame.turnPlayerId),
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
    !paused &&
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
  // When the roll leaves no real choice — one legal move, or several
  // identical ones (a six with every pawn still in base) — play it for
  // the player after a beat instead of making them find and click a pawn.
  const forcedMove =
    legalPawnIds.length > 0 ? forcedMovePawnId(state.legalMoves) : null;
  // The screen shows a phone's picked piece until the move (or a newer pick) replaces it.
  const previewMove =
    screen && previewPawnId && state.turnPhase === "awaiting_move" && !frame.busy
      ? state.legalMoves.find((m) => m.pawnId === previewPawnId)
      : undefined;
  const screenPreview = previewMove ? describeMove(state, previewMove) : null;
  // Parents pass onMove inline, so read it through a ref — depending on
  // it directly would restart the delay on every render.
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });
  useEffect(() => {
    if (!forcedMove) return;
    const timer = setTimeout(() => void onMoveRef.current(forcedMove), 550);
    return () => clearTimeout(timer);
  }, [forcedMove]);
  // A panel takes focus when it opens from the keyboard, and gives it back to
  // whatever opened it when it closes.
  useEffect(() => {
    if (panel) {
      if (!panelOpener.current && document.activeElement instanceof HTMLElement)
        panelOpener.current = document.activeElement;
      if (keyboardUser.current) panelRef.current?.focus();
    } else if (panelOpener.current) {
      if (keyboardUser.current && panelOpener.current.isConnected) panelOpener.current.focus();
      panelOpener.current = null;
    }
  }, [panel]);
  // Keyboard play: when it's time to choose, focus moves to the first piece;
  // when it's time to roll, to the roll button — unless the player is busy
  // somewhere else (chat, a panel).
  const focusIsFree = () => {
    const active = document.activeElement;
    return (
      !active ||
      active === document.body ||
      !!active.closest(".sim-action-area")
    );
  };
  const choiceKey = forcedMove ? "" : legalPawnIds.join();
  useEffect(() => {
    if (!choiceKey || !keyboardUser.current || !focusIsFree()) return;
    pieceChoices.current?.querySelector("button")?.focus();
  }, [choiceKey]);
  useEffect(() => {
    if (!canRoll || !keyboardUser.current || !focusIsFree()) return;
    rollButton.current?.focus();
  }, [canRoll]);
  // Game Center (iOS app; no-op elsewhere): once a match has fully finished
  // online, mirror the account's server-confirmed results (online-wins total
  // and unlocked achievements) to Game Center. Per decision 17 (F3.4), offline
  // practice and Table Together never report. Resets for the next match.
  const mirrored = useRef(false);
  const matchDone = !localPlay && !practice && !!myPlayerId && state.matchEndReason === "completed";
  useEffect(() => {
    if (!state.matchEndReason) mirrored.current = false;
    if (!matchDone || mirrored.current) return;
    mirrored.current = true;
    void mirrorGameCenterOnlineResults();
  }, [matchDone, state.matchEndReason]);
  useEffect(() => {
    timeline.receive(events, state);
  }, [timeline, events, state]);
  // New events are read out as they arrive; the history already on the
  // table when it opens is not. An offline take-back rewinds the log.
  const announcedSequence = useRef(state.eventSequence);
  useEffect(() => {
    if (state.eventSequence < announcedSequence.current)
      announcedSequence.current = state.eventSequence;
    const fresh = events
      .filter((event) => event.sequence > announcedSequence.current)
      .sort((a, b) => a.sequence - b.sequence);
    for (const event of fresh) announce(announceEvent(event, state, localPlay ? null : myPlayerId));
    if (fresh.length) announcedSequence.current = fresh[fresh.length - 1].sequence;
  }, [events, state, myPlayerId, localPlay, announce]);
  // The turn as the board shows it, so it's said after the roll and move
  // that passed it on, not before.
  const announcedTurn = useRef<string | null>(null);
  useEffect(() => {
    if (state.status !== "in_game" || frame.turnPlayerId === announcedTurn.current) return;
    announcedTurn.current = frame.turnPlayerId;
    announce(announceTurn(state, frame.turnPlayerId, localPlay ? null : myPlayerId));
  }, [frame.turnPlayerId, state, myPlayerId, localPlay, announce]);
  const announcedStatus = useRef(state.status);
  useEffect(() => {
    const ended = state.status === "summary" || state.status === "abandoned";
    if (ended && announcedStatus.current === "in_game")
      announce(announceEnd(state, localPlay ? null : myPlayerId));
    announcedStatus.current = state.status;
  }, [state, myPlayerId, localPlay, announce]);
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
    // The screen's own choices shouldn't become this device's settings for playing.
    if (screen) return;
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
          boardStyle: prefs.boardStyle,
          localColor: me?.color ?? "blue",
          localArms: boardSpec.arms,
        }),
      );
    } catch {}
  }, [prefs, me?.color, screen, boardSpec.arms]);
  useEffect(() => {
    const audio = new Audio("/audio/background_01.mp3");
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
  // Decoded up front so the first roll's sound isn't late either.
  useEffect(() => {
    if (prefs.sound) void preloadSoundEffects();
  }, [prefs.sound]);
  const playedRoll = useRef(frame.rollId);
  useEffect(() => {
    if (playedRoll.current === frame.rollId) return;
    playedRoll.current = frame.rollId;
    if (!prefs.sound) return;
    const rolledSix = frame.dice === 6;
    return playSoundEffect(rolledSix ? "diceSix" : "diceRoll", rolledSix ? 0.7 : 0.45);
  }, [frame.dice, frame.rollId, prefs.sound]);
  const setPref = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
      setPrefs((p) => ({ ...p, [key]: value })),
    [setPrefs],
  );
  const reset = useCallback(() => {
    setMode("play");
    setPref("view", screen ? "table" : defaultCameraView());
    setResetKey((n) => n + 1);
  }, [setPref, setMode, setResetKey, screen]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (leaving) {
          setLeaving(false);
          return;
        }
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
  }, [canRoll, leaving, onRoll, panel, reset, setPref, timeline]);
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
  const visibleMessages = messages.filter((m) => !blockedPlayerIds.includes(m.playerId));
  // Other people at the table (not computer players), for block/report.
  const otherPeople = state.players.filter((p) => !p.isBot && p.id !== myPlayerId);
  async function moderate(action: () => Promise<unknown>, done: string) {
    setModerating(true);
    setModerationNote(null);
    try {
      await action();
      setModerationNote(done);
      setReporting(null);
      setReportDetails("");
    } catch (e) {
      setModerationNote(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setModerating(false);
    }
  }
  const reactions: Record<string, string> = {};
  visibleMessages
    .filter(
      (m) =>
        m.kind === "reaction" && now - new Date(m.createdAt).getTime() < 4500,
    )
    .forEach((m) => {
      reactions[m.playerId] = m.text;
    });
  const videoInScene = !!voice?.joined && !screen && !compactScreen && !videoSlow;
  const sceneVideo = (() => {
    if (!videoInScene || !voice || voice.hideRemoteVideo) return undefined;
    const streams = new Map<string, MediaStream>();
    for (const player of state.players) {
      const stream = voice.remoteVideo.get(player.id);
      if (
        stream &&
        player.cameraOn &&
        !player.isBot &&
        player.id !== myPlayerId &&
        !blockedPlayerIds.includes(player.id)
      )
        streams.set(player.id, stream);
    }
    return streams;
  })();
  const title = frame.replaying
    ? "ACTION REPLAY"
    : state.status === "summary" || state.status === "abandoned"
      ? "MATCH COMPLETE"
      : frame.busy
        ? !localPlay && activePlayer?.id === myPlayerId
          ? `You ${frame.phase === "roll" ? "are rolling" : "are moving"}`
          : `${activePlayer?.displayName ?? "Player"} ${frame.phase === "roll" ? "is rolling" : "is moving"}`
        : isMyTurn
          ? localPlay
            ? `${activePlayer?.displayName ?? "PLAYER"}’S TURN`
            : "YOUR TURN"
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
  // Home comes first wherever the table tools are shown. Mid-game it asks
  // before leaving rather than dropping straight out of the match.
  const homeTool =
    state.status === "in_game" ? (
      <Tool icon="home" label="Home" onClick={() => setLeaving(true)} />
    ) : (
      <Link className="sim-tool" href="/" title="Home" aria-label="Home">
        <Icon name="home" />
      </Link>
    );
  return (
    <main
      className={`simulator ${prefs.immersive ? "is-immersive" : ""} ${screen ? "is-screen" : ""}`}
      ref={root}
    >
      <SceneBoundary>
        <Scene
          loadingLabel="Preparing your table"
          gameType={state.gameType}
          snakesBoard={snakes ? (state.rules?.snakesBoard ?? 0) : 0}
          frame={frame}
          players={scenePlayers}
          myPlayerId={localPlay ? null : myPlayerId}
          turnPlayerId={frame.turnPlayerId}
          legalPawnIds={screenPreview ? [screenPreview.pawnId] : legalPawnIds}
          canRoll={canRoll}
          view={prefs.view}
          mode={mode}
          screen={screen}
          orientation={snakes ? prefs.snakeOrientation : prefs.orientation}
          quality={screen ? screenQuality : prefs.quality}
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
          boardStyle={effectiveBoardStyle}
          room={effectiveRoom}
          hideLabels={prefs.immersive}
          onOpenProfile={profiles ? setProfileSeat : undefined}
          showLevels={profiles}
          brightness={prefs.brightness}
          saturation={prefs.saturation}
          colorBlind={colorBlind}
          reducedMotion={reducedMotion}
          focusedPawnId={focusedPawnId}
          videoStreams={sceneVideo}
          onVideoSelect={setEnlargedVideoId}
          onVideoSlow={() => setVideoSlow(true)}
        />
      </SceneBoundary>
      {profilePlayer && (
        <PlayerProfileDialog
          playerId={profilePlayer.id}
          displayName={profilePlayer.displayName}
          onClose={() => setProfileSeat(null)}
        />
      )}
      <div className="sim-vignette" />
      <div className="sr-only" role="log" aria-live="polite" aria-label="Game announcements">
        {announcements.map((line) => (
          <p key={line.id}>{line.text}</p>
        ))}
      </div>
      {voice && !screen && (
        <VideoTiles
          call={voice}
          players={state.players}
          myPlayerId={myPlayerId}
          blockedPlayerIds={blockedPlayerIds}
          remoteInScene={videoInScene}
          enlargedId={enlargedVideoId}
          onEnlarge={setEnlargedVideoId}
          onBlockPlayer={onBlockPlayer}
          onReportPlayer={
            onReportPlayer
              ? (playerId) => {
                  setModerationNote(null);
                  setReporting(playerId);
                  setPanel("chat");
                }
              : undefined
          }
        />
      )}
      <button
        className="sim-immersive-toggle"
        title={
          prefs.immersive
            ? "Show labels and controls"
            : "Hide labels and controls"
        }
        aria-label={
          prefs.immersive
            ? "Show labels and controls"
            : "Hide labels and controls"
        }
        onClick={() => setPref("immersive", !prefs.immersive)}
      >
        <Icon name={prefs.immersive ? "eye-off" : "look"} />
      </button>
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
        {/* Not a live region: the clock inside it ticks every second. Turns
            and rolls are read out by the announcer below instead. */}
        <div className="sim-turn">
          {activePlayer ? (
            <SeatSymbol
              color={activePlayer.color}
              seatColor={palette[activePlayer.color]}
              className="live-symbol"
            />
          ) : (
            <span className="live-dot" />
          )}
          <strong>{title}</strong>
          <span className="turn-separator" />
          <span>
            {frame.busy
              ? `ROLLED ${frame.dice}`
              : state.turnPhase === "awaiting_move"
                ? `ROLLED ${state.activeDiceValue}`
                : practice
                  ? localPlay
                    ? "TABLE TOGETHER"
                    : "VS COMPUTER"
                  : state.isParty
                    ? "PARTY TABLE"
                    : "PRIVATE TABLE"}
          </span>
          {matchLeft !== null && (
            <time className={`sim-match-clock${matchLeft <= 30 ? " urgent" : ""}`} aria-label="Time left in this match">
              {clock(matchLeft)}
            </time>
          )}
          {seconds !== null &&
            state.status === "in_game" &&
            !paused &&
            !frame.replaying &&
            (!frame.busy || frame.actorId === state.turnPlayerId) && (
              <time className={seconds < 6 ? "urgent" : ""}>
                {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
              </time>
            )}
        </div>
        <div className="sim-session">
          {/* Phones hide the side-tools rail, so Home leads the header there. */}
          <span className="mobile-home-trigger">{homeTool}</span>
          {canPause && onPause && state.status === "in_game" && (
            <Tool
              icon={paused ? "play" : "pause"}
              label={paused ? "Resume match" : "Pause match"}
              onClick={() => void onPause(!paused)}
              disabled={pending || frame.busy}
            />
          )}
          {(
            [
              ["play", "play", "Play (1)"],
              ["look", "cube", "Look (L)"],
              ["rotate", "rotate", "Rotate board (R)"],
            ] as const
          ).map(([value, icon, label]) => (
            <Tool
              key={value}
              icon={icon}
              label={label}
              active={mode === value}
              onClick={() => {
                setMode(value);
                setPanel(null);
              }}
            />
          ))}
          <Tool
            icon="help"
            label="Rules & controls"
            active={panel === "help"}
            onClick={() => togglePanel("help")}
          />
          {onFlip && (
            <Tool
              icon="swap"
              label={`Flip board to ${snakes ? "Luddo" : "Snakes & Ladders"}`}
              onClick={flipBoard}
              disabled={frame.busy || flipping}
            />
          )}
          <span
            className={`connection-dot ${connection !== "connected" ? "reconnecting" : ""}`}
          />
          {practice
            ? localPlay
              ? "OFFLINE · TABLE TOGETHER"
              : "OFFLINE · VS COMPUTER"
            : connection === "connected"
              ? `ROOM ${state.code}`
              : "RECONNECTING"}
          <span className="mobile-tools-trigger">
            <Tool
              icon="settings"
              label="Preferences"
              active={panel === "preferences"}
              onClick={() => togglePanel("preferences")}
            />
          </span>
          <Tool
            icon="menu"
            label="Table menu"
            active={panel === "menu"}
            onClick={() => togglePanel("menu")}
          />
        </div>
      </header>
      {screenPreview && activePlayer && (
        <p className="sim-screen-preview" role="status" style={{ "--seat-color": palette[activePlayer.color] } as React.CSSProperties}>
          <strong>
            <SeatSymbol color={activePlayer.color} seatColor={palette[activePlayer.color]} />
            {activePlayer.displayName}
          </strong>
          <span>
            {snakes ? "" : `Piece ${(state.pawns.find((p) => p.id === screenPreview.pawnId)?.index ?? 0) + 1} · `}
            {screenPreview.text}
          </span>
        </p>
      )}
      {paused && (
        <div className="sim-paused" role="status">
          <Icon name="pause" size={22} />
          <div>
            <strong>{waitingFor ? `Waiting for ${waitingFor.displayName}` : "Game paused"}</strong>
            <span>
              {waitingFor
                ? `Their phone went quiet. A computer takes their turn${waitLeft !== null ? ` in ${clock(waitLeft)}` : ""} if they're not back.`
                : canPause
                  ? "Resume when everyone is ready."
                  : "The host will resume the table."}
            </span>
          </div>
          {canPause && onPause && (
            <button className="sim-primary" onClick={() => void onPause(false)}>
              <Icon name="play" /> Resume
            </button>
          )}
        </div>
      )}
      <aside className="sim-side-tools" aria-label="Table tools">
        {homeTool}
        <Tool
          icon="views"
          label="Camera views"
          active={panel === "camera"}
          onClick={() => togglePanel("camera")}
        />
        <Tool
          icon="grid"
          label="Board & room"
          active={panel === "board"}
          onClick={() => togglePanel("board")}
        />
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
            <Tool
              icon="camera"
              label={
                voice.cameraOn
                  ? "Turn off camera"
                  : !voice.videoAvailable
                    ? "Video isn't available at this table"
                    : voice.joined
                      ? "Turn on camera"
                      : "Start video"
              }
              active={voice.cameraOn}
              disabled={voice.cameraStarting || (!voice.cameraOn && !voice.videoAvailable)}
              onClick={voice.startVideo}
            />
            {voice.joined && (
              <Tool
                icon="phone-off"
                label="Leave voice chat"
                onClick={voice.leave}
                danger
              />
            )}
          </>
        )}
        {canCast(cast) && (
          <Tool
            icon="cast"
            label={castLabel}
            active={cast.connected}
            disabled={cast.connecting}
            onClick={() => toggleCast(cast)}
          />
        )}
        <Tool
          icon="settings"
          label="Preferences"
          active={panel === "preferences"}
          onClick={() => togglePanel("preferences")}
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
              setPref("orientation", prefs.orientation - rotationStep(boardSpec))
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
              setPref("orientation", prefs.orientation + rotationStep(boardSpec))
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
          <p>{instruction}</p>
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
            {onUndo && (
              <button
                className="sim-replay"
                onClick={onUndo}
                disabled={!canUndo || frame.replaying}
                title="Take back your last move"
              >
                <Icon name="undo" />
                Undo
              </button>
            )}
            {mode !== "play" ? (
              <button className="sim-primary" onClick={reset}>
                <Icon name="play" />
                Return to play
              </button>
            ) : (
              <button
                ref={rollButton}
                className="sim-primary sim-primary-roll"
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
              ref={pieceChoices}
              className="sim-piece-choices"
              role="group"
              aria-label="Choose a piece to move"
              onKeyDown={(e) => {
                // Arrow keys step through the pieces, wrapping round.
                const step =
                  e.key === "ArrowRight" || e.key === "ArrowDown"
                    ? 1
                    : e.key === "ArrowLeft" || e.key === "ArrowUp"
                      ? -1
                      : 0;
                if (!step) return;
                e.preventDefault();
                const buttons = Array.from(e.currentTarget.querySelectorAll("button"));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                buttons[(index + step + buttons.length) % buttons.length]?.focus();
              }}
            >
              {state.legalMoves
                .filter((move) => legalPawnIds.includes(move.pawnId))
                .map((move) => {
                  const pawn = state.pawns.find((p) => p.id === move.pawnId);
                  return (
                    <button
                      key={move.pawnId}
                      aria-label={describePieceChoice(state, move)}
                      onClick={() => void onMove(move.pawnId)}
                      onFocus={() => setFocusedPawnId(move.pawnId)}
                      onBlur={() => setFocusedPawnId(null)}
                    >
                      {pawn && <SeatSymbol color={pawn.color} seatColor={palette[pawn.color]} />}
                      Piece {(pawn?.index ?? 0) + 1}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
        <div className="sim-view-note">
          <Icon name="views" size={15} />
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
      {leaving &&
        createPortal(
          <div
            className="sim-dialog-backdrop"
            role="presentation"
            onMouseDown={() => setLeaving(false)}
          >
            <section
              className="sim-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="leave-dialog-title"
              aria-describedby="leave-dialog-body"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <span className="eyebrow">AT YOUR TABLE</span>
              <h2 id="leave-dialog-title">Leave the game?</h2>
              <p id="leave-dialog-body">
                This game is still in progress. If you head back to the
                entrance now, you’ll leave the match.
              </p>
              <div className="sim-dialog-actions">
                <button
                  className="sim-primary"
                  autoFocus
                  onClick={() => setLeaving(false)}
                >
                  <Icon name="play" />
                  Keep playing
                </button>
                <Link href="/" className="panel-secondary">
                  <Icon name="home" />
                  Leave and go to the entrance
                </Link>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {panel && (
        <section
          ref={panelRef}
          className="sim-panel"
          aria-labelledby="sim-panel-title"
          tabIndex={-1}
        >
          <div className="panel-heading">
            <div>
              <span className="eyebrow">AT YOUR TABLE</span>
              <h2 id="sim-panel-title">
                {panel === "camera"
                  ? "Find your perspective"
                  : panel === "board"
                    ? "Board & room"
                    : panel === "preferences"
                      ? "Preferences"
                      : panel === "chat"
                        ? "Table talk"
                        : panel === "help"
                          ? "Rules & controls"
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
                <Icon name="cube" />
                Explore the room
              </button>
            </>
          )}
          {panel === "board" && (
            <>
              <p>The same game, four different tables. Play to earn more.</p>
              <div className="camera-options">
                {(
                  [
                    ["signature", "Signature", "The Luddo House artwork"],
                    ["classic", "Classic", "A traditional printed board"],
                    ["geometric", "Geometric", "Bold shapes, gold accents"],
                    ["aladdin", "Aladdin", "An Arabian-nights table"],
                  ] as const
                ).map(([value, label, desc]) => {
                  const id = boardCosmetic(value);
                  const locked = ownership.ready && !ownership.owns(id);
                  return (
                    <button
                      key={value}
                      className={`${effectiveBoardStyle === value ? "is-selected" : ""} ${locked ? "is-locked" : ""}`}
                      disabled={locked}
                      aria-disabled={locked}
                      onClick={() => {
                        setPref("boardStyle", value);
                        // Also record it as the saved board preference (this
                        // device, and the account when signed in), so the choice
                        // carries to the entrance and other devices.
                        gamePreferences.set("boardStyle", value);
                        mirrorEquip(id);
                        setPanel(null);
                      }}
                    >
                      <Icon name="grid" />
                      <span>
                        <strong>{label}</strong>
                        <small>
                          {locked
                            ? `Locked · ${ownership.requirement(id) ?? "Earned by playing"}`
                            : desc}
                        </small>
                      </span>
                      {effectiveBoardStyle === value && <Icon name="check" size={14} />}
                    </button>
                  );
                })}
              </div>
              <p className="panel-subsection">And the room you play it in.</p>
              <div className="camera-options">
                {(
                  [
                    ["apartment", "Apartment", "A bright city living room"],
                    ["mahogany", "Mahogany study", "Panelled walls, a fire, evening"],
                    ["cafe", "Corner café", "Espresso bar, street window, afternoon"],
                    ["lake", "Lake cabin", "Log walls, a stone hearth, the water"],
                    ["rooftop", "Rooftop", "City lights at dusk, string lights overhead"],
                  ] as const
                ).map(([value, label, desc]) => {
                  const id = roomCosmetic(value);
                  const locked = ownership.ready && !ownership.owns(id);
                  return (
                    <button
                      key={value}
                      className={`${effectiveRoom === value ? "is-selected" : ""} ${locked ? "is-locked" : ""}`}
                      disabled={locked}
                      aria-disabled={locked}
                      onClick={() => {
                        setRoom(value);
                        mirrorEquip(id);
                        setPanel(null);
                      }}
                    >
                      <Icon name="home" />
                      <span>
                        <strong>{label}</strong>
                        <small>
                          {locked
                            ? `Locked · ${ownership.requirement(id) ?? "Earned by playing"}`
                            : desc}
                        </small>
                      </span>
                      {effectiveRoom === value && <Icon name="check" size={14} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {panel === "help" && (
            <>
              <p>Move around the room and spin the board without breaking your flow.</p>
              <div className="setting-row">
                <span>
                  Look around the room
                  <small>Drag or swipe, any time &mdash; no mode needed</small>
                </span>
                <span className="key-hint">Drag</span>
              </div>
              <div className="setting-row">
                <span>
                  Zoom
                  <small>Scroll or pinch, any time</small>
                </span>
                <span className="key-hint">Scroll &middot; pinch</span>
              </div>
              <div className="setting-row">
                <span>
                  Rotate the board
                  <small>Right-drag the table on a mouse</small>
                </span>
                <span className="key-hint">Right-drag</span>
              </div>
              <div className="setting-row">
                <span>
                  Pan the camera
                  <small>Right-drag or two fingers, while in Look mode</small>
                </span>
                <span className="key-hint">L</span>
              </div>
              <div className="setting-row">
                <span>
                  Roll the dice
                  <small>On your turn</small>
                </span>
                <span className="key-hint">Space</span>
              </div>
              <div className="setting-row">
                <span>
                  Camera views
                  <small>Seated &middot; Overhead &middot; Table</small>
                </span>
                <span className="key-hint">1 &middot; 2 &middot; 3</span>
              </div>
              <div className="setting-row">
                <span>Close this panel</span>
                <span className="key-hint">Esc</span>
              </div>
              <p className="panel-note">
                On touch, drag with one finger to look around. To rotate the
                board, tap Rotate above, then drag.
              </p>
              <div className="panel-rules">
                <span className="eyebrow">{snakes ? "SNAKES & LADDERS RULES" : "LUDO RULES"}</span>
                {snakes ? (
                  <SnakesRules />
                ) : (
                  // A game with no rules on record predates room rules, when
                  // getting a piece home earned no extra roll.
                  <LudoRules rules={state.rules ?? { ...DEFAULT_ROOM_RULES, bonusRollOnFinish: false }} />
                )}
                {!practice && !localPlay && <OnlineTableRules />}
              </div>
            </>
          )}
          {panel === "preferences" && (
            <>
              <button
                className="panel-secondary"
                onClick={() => {
                  (frame.replaying ? timeline.stopReplay : timeline.replay)();
                  setPanel(null);
                }}
                disabled={
                  !frame.replaying &&
                  (!frame.canReplay || frame.busy || frame.waitingForEvents)
                }
              >
                <Icon name="replay" />
                {frame.replaying ? "Live table" : "Replay previous action"}
              </button>
              <button
                className="panel-secondary"
                onClick={() => setPanel("camera")}
              >
                <Icon name="camera" />
                Camera views
              </button>
              <button
                className="panel-secondary"
                onClick={() => setPanel("board")}
              >
                <Icon name="grid" />
                Board &amp; room
              </button>
              <button
                className="panel-secondary"
                onClick={() => setPanel("chat")}
              >
                <Icon name="chat" />
                Chat and match activity
              </button>
              {voice && (
                <button
                  className="panel-secondary"
                  disabled={voice.connecting}
                  onClick={() =>
                    voice.joined ? voice.toggleMute() : voice.join()
                  }
                >
                  <Icon name={voice.joined && !voice.muted ? "mic" : "mic-off"} />
                  {voice.joined
                    ? voice.muted
                      ? "Unmute microphone"
                      : "Mute microphone"
                    : "Join voice chat"}
                </button>
              )}
              {voice && (
                <button
                  className="panel-secondary"
                  disabled={voice.cameraStarting || (!voice.cameraOn && !voice.videoAvailable)}
                  onClick={voice.startVideo}
                >
                  <Icon name="camera" />
                  {voice.cameraOn
                    ? "Turn off camera"
                    : !voice.videoAvailable
                      ? "Video isn't available at this table"
                      : voice.joined
                        ? "Turn on camera"
                        : "Start video"}
                </button>
              )}
              {voice?.joined && (
                <button className="panel-secondary" onClick={voice.leave}>
                  <Icon name="phone-off" />
                  Leave voice chat
                </button>
              )}
              {canCast(cast) && (
                <button
                  className="panel-secondary"
                  disabled={cast.connecting}
                  onClick={() => {
                    toggleCast(cast);
                    setPanel(null);
                  }}
                >
                  <Icon name="cast" />
                  {castLabel}
                </button>
              )}
              <button
                className="panel-secondary"
                onClick={() => void toggleFullscreen()}
              >
                <Icon name="expand" />
                {fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              </button>
              <button
                className="panel-secondary"
                onClick={() => {
                  setPref("immersive", !prefs.immersive);
                  setPanel(null);
                }}
              >
                <Icon name={prefs.immersive ? "eye-off" : "look"} />
                {prefs.immersive
                  ? "Show labels and controls"
                  : "Hide labels and controls"}
              </button>
              <label className="setting-row setting-volume">
                <span>
                  Brightness
                  <small>{Math.round(prefs.brightness * 100)}%</small>
                </span>
                <input
                  className="setting-range"
                  type="range"
                  min="0.6"
                  max="1.6"
                  step="0.05"
                  value={prefs.brightness}
                  aria-label="Table brightness"
                  onChange={(e) =>
                    setPref("brightness", Number(e.target.value))
                  }
                />
              </label>
              <label className="setting-row setting-volume">
                <span>
                  Saturation
                  <small>{Math.round(prefs.saturation * 100)}%</small>
                </span>
                <input
                  className="setting-range"
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={prefs.saturation}
                  aria-label="Table color saturation"
                  onChange={(e) =>
                    setPref("saturation", Number(e.target.value))
                  }
                />
              </label>
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
              <label className="setting-row">
                <span>
                  Color-blind mode
                  <small>Easier-to-tell colors, and symbols on pieces and bases</small>
                </span>
                <input
                  type="checkbox"
                  checked={colorBlind}
                  onChange={(e) => setColorBlind(e.target.checked)}
                />
              </label>
              <label className="setting-row">
                <span>
                  Reduce motion
                  <small>
                    {reducedMotion && !reduceMotion
                      ? "On in your device settings"
                      : "No camera glides, hopping pieces or rolling dice"}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={reduceMotion}
                  onChange={(e) => setReduceMotion(e.target.checked)}
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
                onClick={() => {
                  if (snakes) setPref("snakeOrientation", 0);
                  else setPref("orientation", homeRotation(me?.color ?? "blue", boardSpec));
                  // A finger drag on a phone orbits the camera rather than
                  // turning the board, so the board can already be at this
                  // orientation while the player looks at it from another
                  // side. Put the camera back too, and close the panel —
                  // on a phone it covers the board, hiding the turn.
                  reset();
                  setPanel(null);
                }}
              >
                <Icon name="rotate" />
                {snakes ? "Face square 1" : "Bring my color closer"}
              </button>
              <p className="panel-note">
                Your graphics, appearance, sound, music, and board orientation
                are saved on this device. Each game begins in Seated view.
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
                      ? localPlay
                        ? "Table Together · shared device"
                        : "Practice against computers"
                      : `Private table · ${state.code}`}
                  </small>
                </div>
              </div>
              <div className="menu-players">
                {state.players.map((player) => (
                  <div key={player.id}>
                    <PlayerProfileButton
                      playerId={player.id}
                      displayName={player.displayName}
                      isBot={player.isBot}
                      disabled={!profiles}
                    >
                      <PlayerAvatar player={player} size={30} />
                    </PlayerProfileButton>
                    <span>
                      {player.displayName}
                      {!localPlay && player.id === myPlayerId ? " (you)" : ""}
                    </span>
                    <small>{player.isBot ? "Computer" : player.status}</small>
                  </div>
                ))}
              </div>
              {/* A modal over the table rather than the /profile page, so
                  checking your stats never walks you out of a live match. */}
              {profiles && me && (
                <button className="panel-secondary" onClick={() => setProfileSeat(me.id)}>
                  <Icon name="user" />
                  Your profile
                </button>
              )}
              {onFlip && (
                <button
                  className="panel-secondary"
                  onClick={flipBoard}
                  disabled={frame.busy || flipping}
                >
                  <Icon name="swap" />
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
              {onSetWatching && !state.isParty && (
                state.watchingEnabled ? (
                  <>
                    <button
                      className="panel-secondary"
                      onClick={() =>
                        void navigator.clipboard
                          ?.writeText(webUrl(`/watch?room=${state.roomId}`))
                          .catch(() => {})
                      }
                    >
                      <Icon name="link" />
                      Copy watch link
                      {state.watcherCount ? ` · ${state.watcherCount} watching` : ""}
                    </button>
                    <button
                      className="panel-secondary"
                      onClick={() => void onSetWatching(false)}
                    >
                      <Icon name="eye-off" />
                      Turn off watching
                    </button>
                  </>
                ) : (
                  state.hostPlayerId === myPlayerId && (
                    <button
                      className="panel-secondary"
                      onClick={() => void onSetWatching(true)}
                    >
                      <Icon name="look" />
                      Let friends watch
                    </button>
                  )
                )
              )}
              {onUndo && (
                <button
                  className="panel-secondary"
                  onClick={() => {
                    onUndo();
                    setPanel(null);
                  }}
                  disabled={!canUndo || frame.replaying}
                >
                  <Icon name="undo" />
                  Undo last move
                </button>
              )}
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
              <button
                className="panel-secondary"
                onClick={() => setPanel("help")}
              >
                <Icon name="help" />
                Rules & controls
              </button>
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
                {onReportPlayer && otherPeople.length > 0 && (
                  <div className="chat-people">
                    <span className="eyebrow">AT THIS TABLE</span>
                    {otherPeople.map((player) => {
                      const blocked = blockedPlayerIds.includes(player.id);
                      return (
                        <div key={player.id} className="chat-person-block">
                          <div className="chat-person">
                            <PlayerProfileButton
                              playerId={player.id}
                              displayName={player.displayName}
                              isBot={player.isBot}
                              disabled={!profiles}
                              className="is-text"
                            >
                              <strong style={{ color: COLORS[player.color] }}>{player.displayName}</strong>
                            </PlayerProfileButton>
                            {onBlockPlayer && (
                              <button
                                type="button"
                                disabled={moderating}
                                onClick={() =>
                                  void moderate(
                                    () => onBlockPlayer(player.id, !blocked),
                                    blocked
                                      ? `${player.displayName} is unblocked.`
                                      : `${player.displayName} is blocked. You won’t see their messages or hear them.`,
                                  )
                                }
                              >
                                {blocked ? "Unblock" : "Block"}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={moderating}
                              aria-expanded={reporting === player.id}
                              onClick={() => {
                                setModerationNote(null);
                                setReporting(reporting === player.id ? null : player.id);
                              }}
                            >
                              Report
                            </button>
                          </div>
                          {reporting === player.id && (
                            <form
                              className="chat-report"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void moderate(async () => {
                                  await onReportPlayer(player.id, reportReason, reportDetails);
                                  if (alsoBlock && !blocked && onBlockPlayer) await onBlockPlayer(player.id, true);
                                }, "Thanks — we’ll review your report within 24 hours.");
                              }}
                            >
                              {player.cameraOn && (
                                <p className="panel-note">
                                  We never record video, so tell us what you saw.
                                </p>
                              )}
                              <label>
                                What happened?
                                <select
                                  value={reportReason}
                                  onChange={(e) => setReportReason(e.target.value as ReportReason)}
                                >
                                  {(Object.keys(REPORT_REASONS) as ReportReason[]).map((reason) => (
                                    <option key={reason} value={reason}>
                                      {REPORT_REASONS[reason]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <textarea
                                aria-label="Details (optional)"
                                placeholder="Details (optional)"
                                maxLength={500}
                                value={reportDetails}
                                onChange={(e) => setReportDetails(e.target.value)}
                              />
                              {!blocked && onBlockPlayer && (
                                <label className="chat-report-check">
                                  <input
                                    type="checkbox"
                                    checked={alsoBlock}
                                    onChange={(e) => setAlsoBlock(e.target.checked)}
                                  />
                                  Also block {player.displayName}
                                </label>
                              )}
                              <div className="chat-report-actions">
                                <button type="button" onClick={() => setReporting(null)}>
                                  Cancel
                                </button>
                                <button type="submit" className="is-danger" disabled={moderating}>
                                  {moderating ? "Sending…" : "Send report"}
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      );
                    })}
                    {moderationNote && (
                      <p className="chat-moderation-note" role="status">
                        {moderationNote}
                      </p>
                    )}
                  </div>
                )}
                {visibleMessages
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
                          ? `rolled ${e.payload.dieValue}${e.payload.needsSixToEnter ? " · needs a six to enter" : e.payload.overshoot ? " · exact roll needed, stays put" : e.payload.cancelledByThirdSix ? " · third six, turn ends" : ""}`
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
                {!events.length && !visibleMessages.length && (
                  <p className="panel-note">
                    The table is ready. Make the first move.
                  </p>
                )}
              </div>
              {onMessage && (
                <>
                  <div className="reaction-tabs" role="tablist" aria-label="Reactions">
                    {(["emoji", "phrases"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={reactionTab === tab}
                        className={reactionTab === tab ? "is-selected" : ""}
                        onClick={() => setReactionTab(tab)}
                      >
                        {tab === "emoji" ? "Emoji" : "Phrases"}
                      </button>
                    ))}
                  </div>
                  {reactionTab === "emoji" ? (
                    <div className="reaction-picker" role="tabpanel" aria-label="Emoji">
                      {REACTION_EMOJI_ROWS.flat().map((emoji) => (
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
                  ) : (
                    <div className="reaction-phrases" role="tabpanel" aria-label="Phrases">
                      {/* "Revenge!" only right after one of your pieces was captured, and first. */}
                      {(revengeReady
                        ? [REVENGE, ...REACTION_PHRASES.filter((phrase) => phrase !== REVENGE)]
                        : REACTION_PHRASES.filter((phrase) => phrase !== REVENGE)
                      ).map((phrase) => (
                        <button
                          key={phrase}
                          disabled={sending}
                          className={phrase === REVENGE ? "is-highlighted" : ""}
                          onClick={() => void sendMessage(phrase, "reaction")}
                        >
                          {phrase}
                        </button>
                      ))}
                    </div>
                  )}
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
            {state.status !== "abandoned" && winner && (
              <div className="victory-avatars">
                {(teams ? teams[0].members : [winner]).map((p) => (
                  <PlayerProfileButton
                    key={p.id}
                    playerId={p.id}
                    displayName={p.displayName}
                    isBot={p.isBot}
                    disabled={!profiles}
                  >
                    <PlayerAvatar player={p} size={76} crowned />
                  </PlayerProfileButton>
                ))}
              </div>
            )}
            <span className="eyebrow">
              {state.status === "abandoned" ? "UNTIL NEXT TIME" : "WELL PLAYED"}
            </span>
            <h1>
              {state.status === "abandoned"
                ? "The table is quiet."
                : teams
                  ? `${teamName(teams[0])} win.`
                  : `${winner?.displayName ?? "Player"} wins.`}
            </h1>
            <p>
              {state.status === "abandoned"
                ? "The match ended when everyone left."
                : teams
                  ? "Eight pieces home. One lovely partnership."
                  : snakes
                  ? "One hundred squares. One lovely game."
                  : "Four pieces home. One lovely game."}
            </p>
            <div className="menu-players">
              {teams?.map((team, index) => (
                <div key={team.lead}>
                  <span className="victory-team-avatars">
                    {team.members.map((p) => (
                      <PlayerProfileButton
                        key={p.id}
                        playerId={p.id}
                        displayName={p.displayName}
                        isBot={p.isBot}
                        disabled={!profiles}
                      >
                        <PlayerAvatar player={p} size={30} placement={index === 0 ? 1 : undefined} />
                      </PlayerProfileButton>
                    ))}
                  </span>
                  <span className="victory-name">
                    {teamName(team)}
                    {!localPlay && team.members.some((p) => p.id === myPlayerId) && " (you)"}
                    <em>{team.lead === "red" ? "Red & Yellow" : "Green & Blue"}</em>
                  </span>
                  <small>{team.finished}/8 home</small>
                </div>
              ))}
              {!teams && [...state.players]
                .sort((a, b) => ranking.indexOf(a.id) - ranking.indexOf(b.id))
                .map((p, index) => {
                  const stats = matchResults?.find((r) => r.playerId === p.id)?.stats;
                  return (
                    <div key={p.id}>
                      <PlayerProfileButton
                        playerId={p.id}
                        displayName={p.displayName}
                        isBot={p.isBot}
                        disabled={!profiles}
                      >
                        <PlayerAvatar
                          player={p}
                          size={30}
                          placement={index < 3 ? ((index + 1) as 1 | 2 | 3) : undefined}
                        />
                      </PlayerProfileButton>
                      <span className="victory-name">
                        {p.displayName}
                        {stats && <em>{statsLine(stats, snakes)}</em>}
                      </span>
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
                  );
                })}
            </div>
            {matchResults && matchResults.length > 0 && (
              <MatchDice results={matchResults} players={state.players} proof={diceProof} />
            )}
            {!practice && !localPlay && state.matchId && state.status === "summary" && (
              <Link
                className="panel-secondary"
                href={`/replay?match=${state.matchId}`}
              >
                <Icon name="replay" />
                Watch the replay
              </Link>
            )}
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
      {practice && <FirstGameTips state={state} myPlayerId={myPlayerId} />}
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
