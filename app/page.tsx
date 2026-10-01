"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import {
  createRoom,
  roomIdForCode,
  setPlayerColor,
  setRoomGame,
  setRoomRules,
} from "@/lib/supabase/rpc";
import { resolveRoomRules } from "@/lib/board/rules";
import { useAgeCheck } from "@/components/lobby/AgeCheck";
import type { GameType, PlayerColor } from "@/lib/board/types";
import { COLORS } from "@/lib/presentation/board";
import { BOT_LEVELS, type BotLevel } from "@/lib/board/bot";
import { AVATARS, avatarDefinition, photoAvatar } from "@/lib/avatars/catalog";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";
import { type BoardStyle } from "@/lib/presentation/simulatorPrefs";
import signatureBoardArt from "@/designs/board-design.webp";
import classicBoardArt from "@/designs/board-classic.svg";
import geometricBoardArt from "@/designs/board-geometric.svg";
import aladdinBoardArt from "@/designs/board-aladdin.svg";
import hexClassicBoardArt from "@/designs/board-hex-classic.svg";
import hexSignatureBoardArt from "@/designs/board-hex-signature.svg";
import hexGeometricBoardArt from "@/designs/board-hex-geometric.svg";
import hexAladdinBoardArt from "@/designs/board-hex-aladdin.svg";
import snakesBoardArt from "@/designs/snake-and-ladder/snakes-and-ladders-board.svg";
import snakesBoardArt2 from "@/designs/snake-and-ladder/snakes-and-ladders-board-2.svg";
import { useGamePreference } from "@/lib/preferences-react";
import { useCosmeticOwnership } from "@/lib/hooks/useCosmeticOwnership";
import { boardCosmetic, ownedBoardStyle } from "@/lib/presentation/cosmeticGates";
import { Icon } from "@/components/simulator/Icon";
import { ProfilePanel } from "@/components/auth/ProfilePanel";
import { ProfileHeaderLink } from "@/components/profile/ProfileHeaderLink";
import { QuickMatch } from "@/components/lobby/QuickMatch";
import { PlayAgain } from "@/components/lobby/PlayAgain";
import { EntranceSheet, Segmented } from "@/components/lobby/EntrancePickers";
import type { Team } from "@/lib/supabase/teams";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import "@/components/simulator/simulator.css";

// Matches the seat_index a color maps to server-side (private.ludo_color_for_seat /
// set_player_color), same order as components/lobby/RoomLobby.tsx's SEAT_COLORS.
const SEAT_COLORS: PlayerColor[] = ["red", "green", "yellow", "blue", "orange", "black"];

// The four board styles (same as the in-game "Board design" panel in
// components/simulator/Simulator.tsx) are built with localized labels inside
// the component — see BOARD_STYLES there.

// How you want to play. The choice drives which config steps follow.
type PlayMode = "quick" | "friends" | "practice" | "together";

// The entrance mode/action labels pack a title and a description around a
// " · " separator (used consistently across every locale catalog). Splitting
// it lets the mode tiles show the same title-over-description layout — and the
// same font sizes — as the game-type step, instead of one oversized line.
function ModeLabel({ label }: { label: string }) {
  const [title, ...rest] = label.split(" · ");
  return (
    <>
      <strong>{title}</strong>
      {rest.length > 0 && <span>{rest.join(" · ")}</span>}
    </>
  );
}

// The title portion of a mode label (before its " · " description) — for the
// launch step's primary button, where the description would just be noise.
const modeTitle = (label: string) => label.split(" · ")[0];
// …and the description after it, shown under the setup screen's title.
const modeDescription = (label: string) => label.split(" · ").slice(1).join(" · ");

const MODE_LABEL_KEYS = {
  quick: "entrance.quickMatch",
  friends: "entrance.playWithFriends",
  practice: "entrance.offlinePractice",
  together: "entrance.tableTogether",
} as const satisfies Record<PlayMode, string>;

// The entrance is two screens, not a wizard of Continue buttons:
//   1. "How do you want to play?" — tapping a mode goes straight on.
//   2. One setup screen with only the choices that mode needs, each a
//      compact segmented row, and the launch button pinned beneath them.
// Avatar and board design are cosmetic, saved preferences, so they live in a
// bottom sheet ("Make it yours") instead of costing everyone a screen.
// (Party mode needs no config, so its tile navigates straight to /screen.)
//
// The screen is mirrored into the URL (?play=<mode>, plus &look=1 while the
// sheet is open) with history.pushState, so the phone's back gesture — and
// Android's hardware back button inside the Capacitor app — steps back
// through the flow instead of leaving the app.
const PLAY_MODES: readonly PlayMode[] = ["quick", "friends", "practice", "together"];
const isPlayMode = (value: string | null): value is PlayMode =>
  PLAY_MODES.includes(value as PlayMode);

// Thumbnails for the board picker: the same artwork the 3D table renders
// (and that usePreloadBoardScene already fetches for the square boards), in
// its hexagonal version when the table seats 5-6.
const BOARD_THUMBNAILS: Record<"square" | "hex", Record<BoardStyle, string>> = {
  square: {
    classic: classicBoardArt.src as string,
    signature: signatureBoardArt.src,
    geometric: geometricBoardArt.src as string,
    aladdin: aladdinBoardArt.src as string,
  },
  hex: {
    classic: hexClassicBoardArt.src as string,
    signature: hexSignatureBoardArt.src as string,
    geometric: hexGeometricBoardArt.src as string,
    aladdin: hexAladdinBoardArt.src as string,
  },
};

// The two printed Snakes & Ladders boards (F2.6), by their snakesBoard rule
// value — the same artwork the 3D table renders for each.
const SNAKES_BOARD_THUMBNAILS: Record<0 | 1, string> = {
  0: snakesBoardArt.src as string,
  1: snakesBoardArt2.src as string,
};

// Maps a bot level to its localized label key (resolved via t() at render).
const BOT_LEVEL_KEYS = {
  easy: "entrance.botEasy",
  normal: "entrance.botNormal",
  hard: "entrance.botHard",
} as const satisfies Record<BotLevel, string>;
// Maps a base color to its localized name key.
const COLOR_KEYS = {
  red: "colors.red",
  green: "colors.green",
  yellow: "colors.yellow",
  blue: "colors.blue",
  orange: "colors.orange",
  black: "colors.black",
} as const satisfies Record<PlayerColor, string>;

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  // Localized board labels/descriptions, mirroring BOARD_STYLE_VALUES' order.
  const BOARD_STYLES: { value: BoardStyle; label: string; desc: string }[] = [
    { value: "classic", label: t("entrance.boardClassic"), desc: t("entrance.boardClassicDesc") },
    { value: "signature", label: t("entrance.boardSignature"), desc: t("entrance.boardSignatureDesc") },
    { value: "geometric", label: t("entrance.boardGeometric"), desc: t("entrance.boardGeometricDesc") },
    { value: "aladdin", label: t("entrance.boardAladdin"), desc: t("entrance.boardAladdinDesc") },
  ];
  // "Vs Computer" is the highlighted default — the fastest way into a game,
  // and the one that needs no one else online. Once a mode has been picked,
  // its tile stays highlighted so coming back shows where the player was.
  const [mode, setMode] = useState<PlayMode>("practice");
  const [quickMatch, setQuickMatch] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [gameType, setGameType] = useState<GameType>("ludo");
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4 | 5 | 6>(2);
  // 5-6 seats are the hexagonal board (F5.2): private online Ludo tables
  // only. Quick match, the offline modes and Snakes & Ladders stay 2-4, so
  // the count carried forward is clamped to what the chosen mode allows —
  // the pick itself is kept for when the player switches back.
  const maxSeats = mode === "friends" && gameType === "ludo" ? 6 : 4;
  const tableSize = Math.min(playerCount, maxSeats) as 2 | 3 | 4 | 5 | 6;
  // Must stay valid for the default playerCount (2): a seat's color maps
  // 1:1 to its index (red=0 ... black=5), and red (seat 0) is the only
  // choice guaranteed in range for every possible player count.
  // Favorite base color is a saved preference (this device, or the account
  // when signed in). A session pick overrides it, and either way it's clamped
  // to a real seat for the current table size: any of the four cross colors
  // is valid for 2 players (the second seat takes the diagonal), but orange
  // and black exist only on the 5-6 player hexagon, and a smaller table can
  // leave a higher-index color out of range, which the create_room /
  // set_player_color RPCs would reject.
  const [favoriteColor, setFavoriteColor] = useGamePreference("baseColor");
  const [pickedColor, setPickedColor] = useState<PlayerColor | null>(null);
  const chosenColor = pickedColor ?? favoriteColor;
  const colorSeats = tableSize === 2 ? 4 : tableSize;
  const playerColor =
    SEAT_COLORS.indexOf(chosenColor) >= colorSeats ? SEAT_COLORS[0] : chosenColor;
  // null = follow the signed-in profile's saved avatar (PracticeTable
  // applies it itself when the link carries no ?avatar=); a string is an
  // explicit pick on this screen and wins over the profile.
  const [pickedAvatar, setPlayerAvatar] = useState<string | null>(null);
  // Offline computer difficulty — a saved preference, synced when signed in.
  const [botLevel, setBotLevel] = useGamePreference("botLevel");
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const playerAvatar = pickedAvatar ?? profileAvatar ?? AVATARS[0].id;
  // An uploaded photo isn't one of the presets, so it gets its own tile.
  const profilePhoto =
    profileAvatar && !avatarDefinition(profileAvatar) ? photoAvatar(profileAvatar) : null;
  const avatarPortrait =
    playerAvatar === profileAvatar && profilePhoto
      ? profilePhoto.portrait
      : (avatarDefinition(playerAvatar) ?? AVATARS[0]).portrait;
  // Board design — a saved preference, synced when signed in; the entrance's
  // highlight then matches what the table will render (Classic by default).
  const [savedBoardStyle, setBoardStyle] = useGamePreference("boardStyle");
  // Boards are earned (F3.5): only owned ones are offered, and a saved board
  // the account doesn't own shows (and launches) as the free default.
  const ownership = useCosmeticOwnership();
  const boardStyle = ownedBoardStyle(savedBoardStyle, ownership.owns);
  // Which printed Snakes & Ladders board to play — a game rule (it moves the
  // snakes and ladders), so it rides along to the table rather than being a
  // look-only preference like the Ludo board design.
  const [snakesBoard, setSnakesBoard] = useState<0 | 1>(0);
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const age = useAgeCheck();
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [screen, setScreen] = useState<"mode" | "setup">("mode");
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  // Play with friends either starts a table or joins one by code; joining
  // needs none of the table setup, so it swaps the setup rows for the code.
  const [friendsAction, setFriendsAction] = useState<"create" | "join">("create");
  // Which way the last screen change went, so the new screen slides in from
  // the matching side (forward from the end edge, back from the start edge).
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  // History entries this page pushed — only those may be unwound with
  // history.back(); anything earlier belongs to whatever page came before.
  const pushedEntries = useRef(0);
  usePreloadBoardScene();

  // Reads the flow position back out of the URL (see the note on PLAY_MODES).
  const applyUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const play = params.get("play");
    const next = isPlayMode(play) ? "setup" : "mode";
    if (isPlayMode(play)) setMode(play);
    setScreen(next);
    setDirection(next === "setup" ? "forward" : "back");
    setAvatarSheetOpen(next === "setup" && params.get("look") === "1");
    setError(null);
  }, []);
  useEffect(() => {
    // A reload restores the setup screen, but never reopens the sheet over it.
    const params = new URLSearchParams(window.location.search);
    if (params.has("look")) {
      params.delete("look");
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
    }
    // Deferred a frame: the static HTML always renders the first screen, so
    // hydration must match it before the URL's screen takes over.
    const frame = requestAnimationFrame(applyUrl);
    function onPopState() {
      pushedEntries.current = Math.max(0, pushedEntries.current - 1);
      applyUrl();
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("popstate", onPopState);
    };
  }, [applyUrl]);
  function go(query: string) {
    window.history.pushState(null, "", `${window.location.pathname}${query}`);
    pushedEntries.current += 1;
    applyUrl();
  }
  function goBack() {
    if (pushedEntries.current > 0) {
      window.history.back(); // popstate re-applies the URL
      return;
    }
    // Arrived straight on ?play= (a reload or shared link): step back in place.
    const params = new URLSearchParams(window.location.search);
    params.delete(params.has("look") ? "look" : "play");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    applyUrl();
  }
  function chooseMode(next: PlayMode) {
    go(`?play=${next}`);
  }
  function pickAvatar(id: string | null) {
    setPlayerAvatar(id);
    goBack();
  }
  async function enter(kind: "create" | "join") {
    if (!name.trim()) {
      setError(t("entrance.nameError"));
      return;
    }
    if (kind === "join" && !code.trim()) {
      setError(t("entrance.codeError"));
      return;
    }
    setPending(kind);
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      if (kind === "join") {
        const roomId = await roomIdForCode(client, code.trim());
        try { localStorage.setItem("luddo-player-name", name.trim()); } catch { /* Optional. */ }
        router.push(`/room?id=${roomId}`);
        return;
      }
      const room = await createRoom(client, name.trim(), undefined, tableSize);
      if (kind === "create" && playerColor !== "red")
        await setPlayerColor(client, room.roomId, playerColor);
      if (kind === "create" && gameType !== "ludo") {
        const state = await setRoomGame(client, room.roomId, gameType);
        if (gameType === "snakes_and_ladders" && snakesBoard === 1)
          await setRoomRules(client, room.roomId, {
            ...resolveRoomRules(state.rules),
            snakesBoard,
          });
      }
      router.push(`/room?id=${room.roomId}`);
    } catch (e) {
      setPending(null);
      if (age.handle(e, () => void enter(kind))) return;
      setError(
        e instanceof Error ? e.message : t("common.connectError"),
      );
    }
  }
  // A team's members are already known, so starting their table is one
  // click from the home page. This is the first screen, before the name
  // field, so the player's name in that team stands in when none is typed.
  async function startForTeam(team: Team) {
    setPending("create");
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      const { data } = await client.auth.getUser();
      const displayName =
        name.trim() || team.members.find((m) => m.userId === data.user?.id)?.displayName || "";
      if (!displayName) {
        setPending(null);
        setError(t("entrance.nameError"));
        return;
      }
      const room = await createRoom(client, displayName, team.id);
      if (gameType !== "ludo") await setRoomGame(client, room.roomId, gameType);
      router.push(`/room?id=${room.roomId}`);
    } catch (e) {
      setPending(null);
      if (age.handle(e, () => void startForTeam(team))) return;
      setError(e instanceof Error ? e.message : t("common.connectError"));
    }
  }
  // Joining a team's or a friend's table goes through its room link, like a
  // shared invite: the room page takes a seated player straight back in
  // (mid-game too), asks a new one for just a name, and explains a table
  // that's full or already playing.
  function openRoom(roomId: string) {
    router.push(`/room?id=${roomId}`);
  }
  async function openRoomByCode(roomCode: string) {
    setPending("join");
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      openRoom(await roomIdForCode(client, roomCode));
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : t("common.connectError"));
    }
  }
  return (
    <main className="sim-entrance">
      {age.gate}
      {/* A static image, not the live 3D scene — this page is the very
          first thing anyone sees, so it shouldn't wait on a Three.js/WebGL
          bundle and a render just to show a decorative background. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP background. */}
      <img
        className="entrance-bg-image"
        src="/images/entrance-board.webp"
        alt=""
        fetchPriority="high"
      />
      <div className="entrance-shade" />
      <header className="entrance-header">
        <div className="sim-brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            LUDDO<small>HOUSE</small>
          </span>
        </div>
        <div className="entrance-header-actions">
          <span>{t("entrance.headerTagline").toUpperCase()}</span>
          <LanguageSwitcher className="profile-trigger" />
          <Link className="profile-trigger leaderboard-trigger" href="/leaderboard">
            <Icon name="trophy" />
            <small>{t("common.leaderboard")}</small>
          </Link>
          <Link className="profile-trigger leaderboard-trigger" href="/tournaments">
            <Icon name="bracket" />
            <small>{t("common.tournaments")}</small>
          </Link>
          <ProfileHeaderLink />
          <ProfilePanel
            onNameChange={setName}
            onTeamsChange={setTeams}
            onAvatarChange={setProfileAvatar}
          />
        </div>
      </header>
      <section className={`entrance-content${screen === "setup" && !quickMatch ? " is-setup" : ""}`}>
        {!quickMatch && screen === "mode" && <PlayAgain onJoin={(roomCode) => void openRoomByCode(roomCode)} />}
        {quickMatch ? (
          <QuickMatch
            gameType={gameType}
            // Quick match tables are 2-4 only (F5.2: the 5-6 hex board is
            // private/party rooms until matchmaking volume can fill them).
            playerCount={Math.min(tableSize, 4) as 2 | 3 | 4}
            displayName={name.trim() || t("common.player")}
            onCancel={() => setQuickMatch(false)}
          />
        ) : screen === "mode" ? (
          <div className="entrance-screen" data-direction={direction} key="mode">
            <span className="eyebrow">{t("entrance.eyebrowHome").toUpperCase()}</span>
            <h1>
              {t("entrance.heroLine1")}
              <br />
              {t("entrance.heroLine2")}
              <br />
              <em>{t("entrance.heroEmphasis")}</em>
            </h1>
            <p>{t("entrance.heroSubtitle")}</p>
            <fieldset className="entrance-game-choice entrance-mode-choice">
              <legend>{t("entrance.chooseMode")}</legend>
              <p className="entrance-mode-group">{t("entrance.playOnline")}</p>
              <div>
                {(["quick", "friends"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={mode === m ? "is-selected" : ""}
                    onClick={() => chooseMode(m)}
                  >
                    <ModeLabel label={t(MODE_LABEL_KEYS[m])} />
                    <Icon name="arrow" />
                  </button>
                ))}
                {/* Party mode needs no setup, so it leaves the flow directly. */}
                <Link className="entrance-mode-link" href="/screen">
                  <ModeLabel label={t("entrance.partyMode")} />
                  <Icon name="arrow" />
                </Link>
              </div>
              <p className="entrance-mode-group">{t("entrance.playOffline")}</p>
              <div>
                {(["practice", "together"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={mode === m ? "is-selected" : ""}
                    onClick={() => chooseMode(m)}
                  >
                    <ModeLabel label={t(MODE_LABEL_KEYS[m])} />
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
            </fieldset>
            {teams.length > 0 && (
              <div className="entrance-team-card">
                {teams.map((team) => {
                  const room = team.activeRoom;
                  // "Join now" only where it works: back to your own seat, or a
                  // lobby with a seat free. A game you're not in (or a full
                  // lobby) shouldn't stop the team starting another.
                  const canJoin =
                    !!room && (room.isSeated || (room.status === "lobby" && room.seatsTaken < room.maxPlayers));
                  return (
                    <div key={team.id} className="entrance-team-row">
                      <div>
                        <span className="eyebrow">{t("entrance.yourTeam").toUpperCase()}</span>
                        <strong>{team.name}</strong>
                        <small>
                          {team.members.length === 1
                            ? t("entrance.memberOne", { count: team.members.length })
                            : t("entrance.memberOther", { count: team.members.length })}
                          {room &&
                            (room.status === "lobby"
                              ? t("entrance.tableOpen", { seated: room.seatsTaken, max: room.maxPlayers })
                              : t("entrance.gameInProgress"))}
                        </small>
                        {canJoin && (
                          <button
                            type="button"
                            className="entrance-team-new"
                            disabled={pending !== null}
                            onClick={() => void startForTeam(team)}
                          >
                            {t("entrance.newTable")}
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        className="sim-primary"
                        disabled={pending !== null}
                        onClick={() => (canJoin ? openRoom(room.roomId) : void startForTeam(team))}
                      >
                        <span>{canJoin ? t("entrance.joinNow") : t("entrance.startTable")}</span>
                        <Icon name="arrow" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {error && (
              <p className="entrance-error" role="alert">
                {error}
              </p>
            )}
            <p className="entrance-caption">{t("entrance.caption")}</p>
          </div>
        ) : (
          <form
            className="entrance-screen entrance-setup"
            data-direction={direction}
            key={`setup-${mode}`}
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "quick") setQuickMatch(true);
              if (mode === "friends") void enter(friendsAction);
            }}
          >
            <div className="entrance-setup-head">
              <button
                type="button"
                className="entrance-back"
                aria-label={t("common.back")}
                onClick={goBack}
              >
                <Icon name="arrow" />
              </button>
              <div>
                <h2>{modeTitle(t(MODE_LABEL_KEYS[mode]))}</h2>
                <p>{modeDescription(t(MODE_LABEL_KEYS[mode]))}</p>
              </div>
            </div>
            {mode === "friends" && (
              <Segmented
                label={t("entrance.chooseMode")}
                hideLabel
                options={[
                  { value: "create", label: t("entrance.createTab") },
                  { value: "join", label: t("entrance.joinTab") },
                ]}
                value={friendsAction}
                onChange={(value) => {
                  setFriendsAction(value);
                  setError(null);
                }}
              />
            )}
            {mode === "friends" && friendsAction === "join" ? (
              <label className="entrance-field">
                <span className="entrance-field-label">{t("entrance.roomCode")}</span>
                <input
                  className="entrance-input entrance-code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder={t("entrance.roomCodePlaceholder")}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  enterKeyHint="go"
                  // Room codes are always Latin/numeric — keep them LTR even
                  // when the surrounding UI is a right-to-left language.
                  dir="ltr"
                />
              </label>
            ) : (
              <>
                <Segmented
                  label={t("entrance.gameLabel")}
                  options={[
                    { value: "ludo", label: t("entrance.ludo") },
                    { value: "snakes_and_ladders", label: t("entrance.snakes") },
                  ]}
                  value={gameType}
                  onChange={setGameType}
                  hint={
                    gameType === "ludo"
                      ? t("entrance.ludoDescription")
                      : t("entrance.snakesDescription")
                  }
                />
                <Segmented
                  label={t("entrance.playersLabel")}
                  options={([2, 3, 4, 5, 6] as const)
                    .filter((count) => count <= maxSeats)
                    .map((count) => ({
                      value: count,
                      label: count,
                      ariaLabel:
                        count === 2
                          ? t("entrance.youPlusOne")
                          : t("entrance.youPlusN", { count: count - 1 }),
                    }))}
                  value={tableSize}
                  // The effective playerColor is clamped to a valid seat for
                  // the table size (see its derivation above), so shrinking
                  // the table never leaves an out-of-range color — and the
                  // saved favorite is preserved for when the table grows back.
                  onChange={setPlayerCount}
                  hint={
                    tableSize >= 5
                      ? t("entrance.hexBoardNote")
                      : mode === "friends" || mode === "quick"
                        ? t("entrance.openSeatsNote")
                        : undefined
                  }
                />
                {mode === "practice" && gameType === "ludo" && (
                  <Segmented
                    label={t("entrance.levelLabel")}
                    options={BOT_LEVELS.map((level) => ({
                      value: level,
                      label: t(BOT_LEVEL_KEYS[level]),
                    }))}
                    value={botLevel}
                    onChange={setBotLevel}
                  />
                )}
                {(mode === "practice" || mode === "friends") && (
                  <div className="entrance-field">
                    <span className="entrance-field-label">{t("entrance.youLabel")}</span>
                    <div className="entrance-you">
                      <button
                        type="button"
                        className="entrance-you-avatar"
                        aria-label={t("entrance.editAvatar")}
                        onClick={() => go(`?play=${mode}&look=1`)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local WebP thumbnails or the user's Storage photo URL. */}
                        <img
                          src={avatarPortrait}
                          alt=""
                          data-photo-style={
                            playerAvatar === profileAvatar ? profilePhoto?.style : undefined
                          }
                        />
                        <span aria-hidden="true">✎</span>
                      </button>
                      <div
                        className="entrance-swatches"
                        role="radiogroup"
                        aria-label={t("entrance.chooseBase")}
                      >
                        {(tableSize === 2
                          ? SEAT_COLORS.slice(0, 4)
                          : SEAT_COLORS.slice(0, tableSize)
                        ).map((color) => (
                          <button
                            key={color}
                            type="button"
                            role="radio"
                            className={playerColor === color ? "is-selected" : ""}
                            aria-label={t("entrance.baseAria", { color: t(COLOR_KEYS[color]) })}
                            aria-checked={playerColor === color}
                            style={{ background: COLORS[color] }}
                            onClick={() => {
                              setPickedColor(color);
                              setFavoriteColor(color);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {(mode === "practice" || mode === "friends") && gameType === "ludo" && (
                  <Segmented
                    label={t("entrance.boardLabel")}
                    options={BOARD_STYLES.filter((style) =>
                      ownership.owns(boardCosmetic(style.value)),
                    ).map((style) => ({
                      value: style.value,
                      label: style.label,
                      ariaLabel: `${style.label} · ${style.desc}`,
                    }))}
                    value={boardStyle}
                    onChange={setBoardStyle}
                    hint={
                      <span className="entrance-board-preview">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local board artwork (SVG/WebP) shared with the 3D table's cache. */}
                        <img
                          key={`${tableSize >= 5 ? "hex" : "square"}-${boardStyle}`}
                          src={BOARD_THUMBNAILS[tableSize >= 5 ? "hex" : "square"][boardStyle]}
                          alt=""
                          decoding="async"
                        />
                        <span>{BOARD_STYLES.find((style) => style.value === boardStyle)?.desc}</span>
                      </span>
                    }
                  />
                )}
                {mode !== "quick" && gameType === "snakes_and_ladders" && (
                  <Segmented
                    label={t("entrance.boardLabel")}
                    options={([0, 1] as const).map((board) => ({
                      value: board,
                      label: board === 0 ? t("entrance.snakesBoardOriginal") : t("entrance.snakesBoardSecond"),
                    }))}
                    value={snakesBoard}
                    onChange={setSnakesBoard}
                    hint={
                      <span className="entrance-board-preview">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local board artwork shared with the 3D table's cache. */}
                        <img
                          key={`snakes-${snakesBoard}`}
                          src={SNAKES_BOARD_THUMBNAILS[snakesBoard]}
                          alt=""
                          decoding="async"
                        />
                        <span>
                          {snakesBoard === 0
                            ? t("entrance.snakesBoardOriginalDesc")
                            : t("entrance.snakesBoardSecondDesc")}
                        </span>
                      </span>
                    }
                  />
                )}
              </>
            )}
            {(mode === "quick" || mode === "friends") && (
              <label className="entrance-field">
                <span className="entrance-field-label">{t("entrance.yourName")}</span>
                <input
                  className="entrance-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  placeholder={t("entrance.yourNamePlaceholder")}
                  autoComplete="nickname"
                  enterKeyHint="go"
                />
              </label>
            )}
            {error && (
              <p className="entrance-error" role="alert">
                {error}
              </p>
            )}
            <div className="entrance-launch">
              {mode === "quick" && (
                <button type="submit" className="sim-primary">
                  <span>{modeTitle(t("entrance.quickMatch"))}</span>
                  <Icon name="arrow" />
                </button>
              )}
              {mode === "friends" && (
                <button type="submit" className="sim-primary" disabled={pending !== null}>
                  <span>
                    {friendsAction === "join"
                      ? pending === "join"
                        ? t("entrance.findingFriends")
                        : t("entrance.joinTheirTable")
                      : pending === "create"
                        ? t("entrance.preparingRoom")
                        : t("entrance.createTable")}
                  </span>
                  <Icon name="arrow" />
                </button>
              )}
              {mode === "practice" && (
                <Link
                  className="sim-primary"
                  href={`/practice?players=${tableSize}&color=${playerColor}${pickedAvatar ? `&avatar=${encodeURIComponent(pickedAvatar)}` : ""}&game=${gameType}${gameType === "ludo" ? `&level=${botLevel}` : `&board=${snakesBoard}`}`}
                >
                  <span>{modeTitle(t("entrance.offlinePractice"))}</span>
                  <Icon name="dice" />
                </Link>
              )}
              {mode === "together" && (
                <Link
                  className="sim-primary"
                  href={`/table-together?players=${tableSize}&game=${gameType}${gameType === "snakes_and_ladders" ? `&board=${snakesBoard}` : ""}`}
                >
                  <span>{modeTitle(t("entrance.tableTogether"))}</span>
                  <Icon name="users" />
                </Link>
              )}
            </div>
          </form>
        )}
      </section>
      <EntranceSheet
        open={avatarSheetOpen}
        title={t("entrance.chooseAvatar")}
        doneLabel={t("entrance.done")}
        onClose={goBack}
      >
        <div className="entrance-avatar-grid">
          {profileAvatar && profilePhoto && (
            <button
              type="button"
              className={playerAvatar === profileAvatar ? "is-selected" : ""}
              aria-label={t("entrance.yourProfilePhoto")}
              aria-pressed={playerAvatar === profileAvatar}
              onClick={() => pickAvatar(null)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded avatar photos are user Storage URLs. */}
              <img src={profilePhoto.portrait} alt="" data-photo-style={profilePhoto.style} />
            </button>
          )}
          {AVATARS.map((avatar) => (
            <button
              key={avatar.id}
              type="button"
              className={playerAvatar === avatar.id ? "is-selected" : ""}
              aria-label={avatar.label}
              aria-pressed={playerAvatar === avatar.id}
              onClick={() => pickAvatar(avatar.id === profileAvatar ? null : avatar.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP thumbnails. */}
              <img src={avatar.portrait} alt="" />
            </button>
          ))}
        </div>
        <small className="entrance-field-hint">
          {profileAvatar ? t("entrance.profileAvatarPicked") : t("entrance.signInForPhoto")}
        </small>
      </EntranceSheet>
      <div className="entrance-room-label">
        <span>{t("entrance.roomLabelEyebrow").toUpperCase()}</span>
        <p>{BRAND.name}</p>
      </div>
      <footer className="entrance-footer">
        <span>
          <span className="entrance-footer-tagline">
            {BRAND.tagline.toUpperCase()}. {t("entrance.footerTagline").toUpperCase()}
          </span>
          <Link href="/support" className="entrance-footer-link">
            {t("common.support").toUpperCase()}
          </Link>
          <Link href="/privacy" className="entrance-footer-link">
            {t("common.privacy").toUpperCase()}
          </Link>
        </span>
        <span className="entrance-footer-tagline">
          <i className="connection-dot" />
          {t("entrance.footerRight").toUpperCase()}
        </span>
      </footer>
    </main>
  );
}
