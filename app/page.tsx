"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { createRoom, joinRoom, roomIdForCode, setPlayerColor, setRoomGame } from "@/lib/supabase/rpc";
import { useAgeCheck } from "@/components/lobby/AgeCheck";
import type { GameType, PlayerColor } from "@/lib/board/types";
import { COLORS } from "@/lib/presentation/board";
import { BOT_LEVELS, type BotLevel } from "@/lib/board/bot";
import { AVATARS, avatarDefinition, photoAvatar } from "@/lib/avatars/catalog";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";
import { type BoardStyle } from "@/lib/presentation/simulatorPrefs";
import { useGamePreference } from "@/lib/preferences-react";
import { Icon } from "@/components/simulator/Icon";
import { ProfilePanel } from "@/components/auth/ProfilePanel";
import { QuickMatch } from "@/components/lobby/QuickMatch";
import { PlayAgain } from "@/components/lobby/PlayAgain";
import type { Team } from "@/lib/supabase/teams";
import { BRAND } from "@/lib/brand";
import { useI18n } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import "@/components/simulator/simulator.css";

// Matches the seat_index a color maps to server-side (private.ludo_color_for_seat /
// set_player_color), same order as components/lobby/RoomLobby.tsx's SEAT_COLORS.
const SEAT_COLORS: PlayerColor[] = ["red", "green", "yellow", "blue"];

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

// The wizard opens on "mode" (how do you want to play), then walks only the
// config steps that mode needs before the final "start" step launches it:
//   quick / together — just game type + player count.
//   friends / practice — also color + avatar, plus Ludo's board design.
// (Party mode needs no config, so its tile navigates straight to /screen.)
function stepsFor(mode: PlayMode | null, gameType: GameType): readonly string[] {
  if (!mode) return ["mode"];
  if (mode === "quick" || mode === "together") return ["mode", "game", "start"];
  return gameType === "ludo"
    ? ["mode", "game", "setup", "board", "start"]
    : ["mode", "game", "setup", "start"];
}

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
  // Open the wizard with "Vs Computer" already chosen — the fastest way into a
  // game, and the one that needs no one else online — so the mode step reads as
  // a ready default the player can accept or change rather than a blank choice.
  const [mode, setMode] = useState<PlayMode | null>("practice");
  const [quickMatch, setQuickMatch] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [gameType, setGameType] = useState<GameType>("ludo");
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  // Must stay valid for the default playerCount (2): a seat's color maps
  // 1:1 to its index (red=0 ... blue=3), and red (seat 0) is the only
  // choice guaranteed in range for every possible player count.
  // Favorite base color is a saved preference (this device, or the account
  // when signed in). A session pick overrides it, and either way it's clamped
  // to a real seat for the current table size: every color is valid for 2
  // players, but a smaller non-2 table can leave a higher-index color out of
  // range, which the create_room / set_player_color RPCs would reject.
  const [favoriteColor, setFavoriteColor] = useGamePreference("baseColor");
  const [pickedColor, setPickedColor] = useState<PlayerColor | null>(null);
  const chosenColor = pickedColor ?? favoriteColor;
  const playerColor =
    playerCount !== 2 && SEAT_COLORS.indexOf(chosenColor) >= playerCount
      ? SEAT_COLORS[0]
      : chosenColor;
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
  // Board design — a saved preference, synced when signed in; the entrance's
  // highlight then matches what the table will render (Classic by default).
  const [boardStyle, setBoardStyle] = useGamePreference("boardStyle");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const age = useAgeCheck();
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [step, setStep] = useState(0);
  usePreloadBoardScene();
  const steps = stepsFor(mode, gameType);
  const currentStep = steps[Math.min(step, steps.length - 1)];
  function next() {
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
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
      const room = await createRoom(client, name.trim(), undefined, playerCount);
      if (kind === "create" && playerColor !== "red")
        await setPlayerColor(client, room.roomId, playerColor);
      if (kind === "create" && gameType !== "ludo")
        await setRoomGame(client, room.roomId, gameType);
      router.push(`/room?id=${room.roomId}`);
    } catch (e) {
      setPending(null);
      if (age.handle(e, () => void enter(kind))) return;
      setError(
        e instanceof Error ? e.message : t("common.connectError"),
      );
    }
  }
  // Skips the manual player-count/color form and code-sharing dance
  // entirely: a team's members are already known, so starting or
  // rejoining their table is one click from the home page.
  async function goToRoom(
    kind: "create" | "join",
    action: (client: ReturnType<typeof createClient>) => Promise<{ roomId: string }>,
  ) {
    if (!name.trim()) {
      setError(t("entrance.nameError"));
      return;
    }
    setPending(kind);
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      const room = await action(client);
      if (kind === "create" && gameType !== "ludo")
        await setRoomGame(client, room.roomId, gameType);
      router.push(`/room?id=${room.roomId}`);
    } catch (e) {
      setPending(null);
      if (age.handle(e, () => void goToRoom(kind, action))) return;
      setError(
        e instanceof Error ? e.message : t("common.connectError"),
      );
    }
  }
  function startForTeam(teamId: string) {
    void goToRoom("create", (client) => createRoom(client, name.trim(), teamId));
  }
  function joinTeamRoom(roomCode: string) {
    void goToRoom("join", (client) => joinRoom(client, roomCode, name.trim()));
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
          <ProfilePanel
            onNameChange={setName}
            onTeamsChange={setTeams}
            onAvatarChange={setProfileAvatar}
          />
        </div>
      </header>
      <section className="entrance-content">
        {!quickMatch && <PlayAgain name={name} onJoin={joinTeamRoom} />}
        {quickMatch ? (
          <QuickMatch
            gameType={gameType}
            playerCount={playerCount}
            displayName={name.trim() || t("common.player")}
            onCancel={() => setQuickMatch(false)}
          />
        ) : (
          <>
            <span className="eyebrow">{t("entrance.eyebrowHome").toUpperCase()}</span>
            <h1>
              {t("entrance.heroLine1")}
              <br />
              {t("entrance.heroLine2")}
              <br />
              <em>{t("entrance.heroEmphasis")}</em>
            </h1>
            <p>{t("entrance.heroSubtitle")}</p>
            <div className="entrance-wizard-progress" role="presentation">
              {steps.map((s, i) => (
                <span
                  key={s}
                  className={
                    i === step ? "is-active" : i < step ? "is-done" : ""
                  }
                />
              ))}
            </div>
            <div className="entrance-wizard-step" key={`${mode ?? "mode"}-${step}`}>
              {currentStep === "mode" && (
                <>
                <fieldset className="entrance-game-choice entrance-mode-choice">
                  <legend>{t("entrance.chooseMode")}</legend>
                  <p className="entrance-mode-group">{t("entrance.playOnline")}</p>
                  <div>
                    <button
                      type="button"
                      className={mode === "quick" ? "is-selected" : ""}
                      aria-pressed={mode === "quick"}
                      onClick={() => setMode("quick")}
                    >
                      <ModeLabel label={t("entrance.quickMatch")} />
                    </button>
                    <button
                      type="button"
                      className={mode === "friends" ? "is-selected" : ""}
                      aria-pressed={mode === "friends"}
                      onClick={() => setMode("friends")}
                    >
                      <ModeLabel label={t("entrance.playWithFriends")} />
                    </button>
                    {/* Party mode needs no setup, so it leaves the wizard directly. */}
                    <Link className="entrance-mode-link" href="/screen">
                      <ModeLabel label={t("entrance.partyMode")} />
                    </Link>
                  </div>
                  <p className="entrance-mode-group">{t("entrance.playOffline")}</p>
                  <div>
                    <button
                      type="button"
                      className={mode === "practice" ? "is-selected" : ""}
                      aria-pressed={mode === "practice"}
                      onClick={() => setMode("practice")}
                    >
                      <ModeLabel label={t("entrance.offlinePractice")} />
                    </button>
                    <button
                      type="button"
                      className={mode === "together" ? "is-selected" : ""}
                      aria-pressed={mode === "together"}
                      onClick={() => setMode("together")}
                    >
                      <ModeLabel label={t("entrance.tableTogether")} />
                    </button>
                  </div>
                </fieldset>
                {teams.length > 0 && (
                  <div className="entrance-team-card">
                    {teams.map((team) => (
                      <div key={team.id} className="entrance-team-row">
                        <div>
                          <span className="eyebrow">{t("entrance.yourTeam").toUpperCase()}</span>
                          <strong>{team.name}</strong>
                          <small>
                            {team.members.length === 1
                              ? t("entrance.memberOne", { count: team.members.length })
                              : t("entrance.memberOther", { count: team.members.length })}
                            {team.activeRoom &&
                              t("entrance.tableOpen", { seated: team.activeRoom.seatsTaken })}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="sim-primary"
                          disabled={pending !== null}
                          onClick={() =>
                            team.activeRoom
                              ? joinTeamRoom(team.activeRoom.code)
                              : startForTeam(team.id)
                          }
                        >
                          <span>
                            {team.activeRoom
                              ? t("entrance.joinNow")
                              : t("entrance.startTable")}
                          </span>
                          <Icon name="arrow" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="entrance-caption">{t("entrance.caption")}</p>
                </>
              )}
              {currentStep === "game" && (
                <>
                <fieldset className="entrance-game-choice">
                  <legend>{t("entrance.chooseGame")}</legend>
                  <div>
                    <button
                      type="button"
                      className={gameType === "ludo" ? "is-selected" : ""}
                      aria-pressed={gameType === "ludo"}
                      onClick={() => setGameType("ludo")}
                    >
                      <strong>{t("entrance.ludo")}</strong>
                      <span>{t("entrance.ludoDescription")}</span>
                    </button>
                    <button
                      type="button"
                      className={
                        gameType === "snakes_and_ladders" ? "is-selected" : ""
                      }
                      aria-pressed={gameType === "snakes_and_ladders"}
                      onClick={() => setGameType("snakes_and_ladders")}
                    >
                      <strong>{t("entrance.snakes")}</strong>
                      <span>{t("entrance.snakesDescription")}</span>
                    </button>
                  </div>
                </fieldset>
                <fieldset className="entrance-player-count">
                  <legend>{t("entrance.howManyPlayers")}</legend>
                  <div>
                    {([2, 3, 4] as const).map((count) => (
                      <button
                        key={count}
                        type="button"
                        className={playerCount === count ? "is-selected" : ""}
                        aria-pressed={playerCount === count}
                        // The effective playerColor is clamped to a valid seat
                        // for the table size (see its derivation above), so
                        // shrinking the table never leaves an out-of-range
                        // color — and the saved favorite is preserved for when
                        // the table grows back.
                        onClick={() => setPlayerCount(count)}
                      >
                        <strong>{count}</strong>
                        <span>
                          {count === 2
                            ? t("entrance.youPlusOne")
                            : t("entrance.youPlusN", { count: count - 1 })}
                        </span>
                      </button>
                    ))}
                  </div>
                  <small>{t("entrance.openSeatsNote")}</small>
                </fieldset>
                </>
              )}
              {currentStep === "setup" && (
                <>
                <fieldset className="entrance-color-choice">
                  <legend>{t("entrance.chooseBase")}</legend>
                  <div>
                    {(playerCount === 2
                      ? SEAT_COLORS
                      : SEAT_COLORS.slice(0, playerCount)
                    ).map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={playerColor === color ? "is-selected" : ""}
                        aria-label={t("entrance.baseAria", { color: t(COLOR_KEYS[color]) })}
                        aria-pressed={playerColor === color}
                        onClick={() => {
                          setPickedColor(color);
                          setFavoriteColor(color);
                        }}
                      >
                        <i style={{ background: COLORS[color] }} />
                        {t(COLOR_KEYS[color])}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="entrance-avatar-choice">
                  <legend>{t("entrance.chooseAvatar")}</legend>
                  <div>
                    {profileAvatar && profilePhoto && (
                      <button
                        type="button"
                        className={playerAvatar === profileAvatar ? "is-selected" : ""}
                        aria-label={t("entrance.yourProfilePhoto")}
                        aria-pressed={playerAvatar === profileAvatar}
                        onClick={() => setPlayerAvatar(null)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded avatar photos are user Storage URLs. */}
                        <img src={profilePhoto.portrait} alt="" data-photo-style={profilePhoto.style} />
                      </button>
                    )}
                    {AVATARS.map((avatar) => (
                      <button
                        key={avatar.id}
                        type="button"
                        className={
                          playerAvatar === avatar.id ? "is-selected" : ""
                        }
                        aria-label={avatar.label}
                        aria-pressed={playerAvatar === avatar.id}
                        onClick={() =>
                          setPlayerAvatar(avatar.id === profileAvatar ? null : avatar.id)
                        }
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP thumbnails. */}
                        <img src={avatar.portrait} alt="" />
                      </button>
                    ))}
                  </div>
                  <small>
                    {profileAvatar
                      ? t("entrance.profileAvatarPicked")
                      : t("entrance.signInForPhoto")}
                  </small>
                </fieldset>
                </>
              )}
              {currentStep === "board" && (
                  <fieldset className="entrance-board-choice">
                    <legend>{t("entrance.chooseBoard")}</legend>
                    <div>
                      {BOARD_STYLES.map((style) => (
                        <button
                          key={style.value}
                          type="button"
                          className={
                            boardStyle === style.value ? "is-selected" : ""
                          }
                          aria-pressed={boardStyle === style.value}
                          onClick={() => setBoardStyle(style.value)}
                        >
                          <strong>{style.label}</strong>
                          <small>{style.desc}</small>
                        </button>
                      ))}
                    </div>
                  </fieldset>
              )}
              {currentStep === "start" && mode === "quick" && (
                <>
                  <button type="button" className="back-button" onClick={back}>
                    {t("common.backArrow")}
                  </button>
                  <label className="entrance-inline-field">
                    {t("entrance.yourName")}
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={24}
                      placeholder={t("entrance.yourNamePlaceholder")}
                      autoComplete="nickname"
                    />
                  </label>
                  <div className="entrance-buttons">
                    <button className="sim-primary" onClick={() => setQuickMatch(true)}>
                      <span>{modeTitle(t("entrance.quickMatch"))}</span>
                      <Icon name="arrow" />
                    </button>
                  </div>
                  <p className="entrance-caption">{t("entrance.caption")}</p>
                </>
              )}
              {currentStep === "start" && mode === "friends" && (
                <form
                  className="entrance-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void enter("create");
                  }}
                >
                  <button type="button" className="back-button" onClick={back}>
                    {t("common.backArrow")}
                  </button>
                  <label>
                    {t("entrance.yourName")}
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={24}
                      placeholder={t("entrance.yourNamePlaceholder")}
                      autoComplete="nickname"
                    />
                  </label>
                  <button className="sim-primary" disabled={pending !== null}>
                    {pending === "create"
                      ? t("entrance.preparingRoom")
                      : t("entrance.createTable")}
                    <Icon name="arrow" />
                  </button>
                  <span className="form-divider">{t("entrance.haveInvitation")}</span>
                  <label>
                    {t("entrance.roomCode")}
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      maxLength={6}
                      placeholder={t("entrance.roomCodePlaceholder")}
                      autoComplete="off"
                      // Room codes are always Latin/numeric — keep them LTR even
                      // when the surrounding UI is a right-to-left language.
                      dir="ltr"
                    />
                  </label>
                  <button
                    className="entrance-secondary"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void enter("join")}
                  >
                    {pending === "join"
                      ? t("entrance.findingFriends")
                      : t("entrance.joinTheirTable")}
                  </button>
                  {error && (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  )}
                </form>
              )}
              {currentStep === "start" && mode === "practice" && (
                <>
                  <button type="button" className="back-button" onClick={back}>
                    {t("common.backArrow")}
                  </button>
                  {gameType === "ludo" && (
                    <fieldset className="entrance-player-count entrance-bot-level">
                      <legend>{t("entrance.offlineComputerLevel")}</legend>
                      <div>
                        {BOT_LEVELS.map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={botLevel === level ? "is-selected" : ""}
                            aria-pressed={botLevel === level}
                            onClick={() => setBotLevel(level)}
                          >
                            <strong>{t(BOT_LEVEL_KEYS[level])}</strong>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <div className="entrance-buttons">
                    <Link
                      className="sim-primary"
                      href={`/practice?players=${playerCount}&color=${playerColor}${pickedAvatar ? `&avatar=${encodeURIComponent(pickedAvatar)}` : ""}&game=${gameType}${gameType === "ludo" ? `&level=${botLevel}` : ""}`}
                    >
                      <span>{modeTitle(t("entrance.offlinePractice"))}</span>
                      <Icon name="dice" />
                    </Link>
                  </div>
                  <p className="entrance-caption">{t("entrance.caption")}</p>
                </>
              )}
              {currentStep === "start" && mode === "together" && (
                <>
                  <button type="button" className="back-button" onClick={back}>
                    {t("common.backArrow")}
                  </button>
                  <div className="entrance-buttons">
                    <Link
                      className="sim-primary"
                      href={`/table-together?players=${playerCount}&game=${gameType}`}
                    >
                      <span>{modeTitle(t("entrance.tableTogether"))}</span>
                      <Icon name="users" />
                    </Link>
                  </div>
                  <p className="entrance-caption">{t("entrance.caption")}</p>
                </>
              )}
            </div>
            {currentStep !== "start" && (
              <div className="entrance-wizard-nav">
                {step > 0 && (
                  <button type="button" className="back-button" onClick={back}>
                    {t("common.backArrow")}
                  </button>
                )}
                <button
                  type="button"
                  className="sim-primary"
                  disabled={currentStep === "mode" && mode === null}
                  onClick={next}
                >
                  <span>{t("common.continue")}</span>
                  <Icon name="arrow" />
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <div className="entrance-room-label">
        <span>{t("entrance.roomLabelEyebrow").toUpperCase()}</span>
        <p>{BRAND.name}</p>
      </div>
      <footer className="entrance-footer">
        <span>
          {BRAND.tagline.toUpperCase()}. {t("entrance.footerTagline").toUpperCase()}
          <Link href="/support" className="entrance-footer-link">
            {t("common.support").toUpperCase()}
          </Link>
          <Link href="/privacy" className="entrance-footer-link">
            {t("common.privacy").toUpperCase()}
          </Link>
        </span>
        <span>
          <i className="connection-dot" />
          {t("entrance.footerRight").toUpperCase()}
        </span>
      </footer>
    </main>
  );
}
