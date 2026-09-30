"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { createRoom, joinRoom, roomIdForCode, setPlayerColor, setRoomGame } from "@/lib/supabase/rpc";
import { useAgeCheck } from "@/components/lobby/AgeCheck";
import type { GameType, PlayerColor } from "@/lib/board/types";
import { COLORS } from "@/lib/presentation/board";
import { BOT_LEVELS, type BotLevel } from "@/lib/board/bot";
import { preferredBotLevel, setPreferredBotLevel } from "@/lib/presentation/simulatorPrefs";
import { AVATARS, avatarDefinition, photoAvatar } from "@/lib/avatars/catalog";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";
import {
  setPreferredBoardStyle,
  type BoardStyle,
} from "@/lib/presentation/simulatorPrefs";
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

// Choose game and player count, then color and avatar, then Ludo's board design.
// Snakes & Ladders skips the board design step.
const LUDO_STEPS = ["game", "setup", "board", "start"] as const;
const SNAKES_STEPS = ["game", "setup", "start"] as const;

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
// The saved level only changes through this page's own picker.
const noSubscription = () => () => {};

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  // Localized board labels/descriptions, mirroring BOARD_STYLE_VALUES' order.
  const BOARD_STYLES: { value: BoardStyle; label: string; desc: string }[] = [
    { value: "signature", label: t("entrance.boardSignature"), desc: t("entrance.boardSignatureDesc") },
    { value: "classic", label: t("entrance.boardClassic"), desc: t("entrance.boardClassicDesc") },
    { value: "geometric", label: t("entrance.boardGeometric"), desc: t("entrance.boardGeometricDesc") },
    { value: "aladdin", label: t("entrance.boardAladdin"), desc: t("entrance.boardAladdinDesc") },
  ];
  const [friends, setFriends] = useState(false);
  const [quickMatch, setQuickMatch] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [gameType, setGameType] = useState<GameType>("ludo");
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  // Must stay valid for the default playerCount (2): a seat's color maps
  // 1:1 to its index (red=0 ... blue=3), and red (seat 0) is the only
  // choice guaranteed in range for every possible player count.
  const [playerColor, setPlayerColorChoice] = useState<PlayerColor>("red");
  // null = follow the signed-in profile's saved avatar (PracticeTable
  // applies it itself when the link carries no ?avatar=); a string is an
  // explicit pick on this screen and wins over the profile.
  const [pickedAvatar, setPlayerAvatar] = useState<string | null>(null);
  // Read from the device after hydration; "normal" on the server.
  const savedBotLevel = useSyncExternalStore(noSubscription, preferredBotLevel, () => "normal" as const);
  const [pickedBotLevel, setPickedBotLevel] = useState<BotLevel | null>(null);
  const botLevel = pickedBotLevel ?? savedBotLevel;
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const playerAvatar = pickedAvatar ?? profileAvatar ?? AVATARS[0].id;
  // An uploaded photo isn't one of the presets, so it gets its own tile.
  const profilePhoto =
    profileAvatar && !avatarDefinition(profileAvatar) ? photoAvatar(profileAvatar) : null;
  const [boardStyle, setBoardStyleChoice] = useState<BoardStyle>("signature");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const age = useAgeCheck();
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [step, setStep] = useState(0);
  usePreloadBoardScene();
  const steps = gameType === "ludo" ? LUDO_STEPS : SNAKES_STEPS;
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
        ) : !friends ? (
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
            <div className="entrance-wizard-step" key={step}>
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
                        onClick={() => {
                          setPlayerCount(count);
                          // A seat's color maps 1:1 to its index (red=0 ... blue=3),
                          // so shrinking the table can leave the previously chosen
                          // color out of range — reset it before that can reach the
                          // create_room/set_player_color RPCs as an INVALID_SEAT.
                          // Every color is valid for 2 (the second seat becomes
                          // whichever base is diagonally opposite), so no reset
                          // is needed there.
                          if (
                            count !== 2 &&
                            SEAT_COLORS.indexOf(playerColor) >= count
                          )
                            setPlayerColorChoice(SEAT_COLORS[0]);
                        }}
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
                        onClick={() => setPlayerColorChoice(color)}
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
                          onClick={() => {
                            setBoardStyleChoice(style.value);
                            setPreferredBoardStyle(style.value);
                          }}
                        >
                          <strong>{style.label}</strong>
                          <small>{style.desc}</small>
                        </button>
                      ))}
                    </div>
                  </fieldset>
              )}
              {currentStep === "start" && (
                <>
                  <button type="button" className="back-button" onClick={back}>
                    {t("common.backArrow")}
                  </button>
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
                            onClick={() => {
                              setPickedBotLevel(level);
                              setPreferredBotLevel(level);
                            }}
                          >
                            <strong>{t(BOT_LEVEL_KEYS[level])}</strong>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <div className="entrance-buttons">
                    <button
                      className="sim-primary"
                      onClick={() => setQuickMatch(true)}
                    >
                      <span>{t("entrance.quickMatch")}</span>
                      <Icon name="arrow" />
                    </button>
                    <button
                      className="entrance-secondary"
                      onClick={() => setFriends(true)}
                    >
                      <span>{t("entrance.playWithFriends")}</span>
                      <Icon name="users" />
                    </button>
                    <Link
                      className="entrance-secondary"
                      href={`/practice?players=${playerCount}&color=${playerColor}${pickedAvatar ? `&avatar=${encodeURIComponent(pickedAvatar)}` : ""}&game=${gameType}${gameType === "ludo" ? `&level=${botLevel}` : ""}`}
                    >
                      <span>{t("entrance.offlinePractice")}</span>
                      <Icon name="dice" />
                    </Link>
                    <Link
                      className="entrance-secondary"
                      href={`/table-together?players=${playerCount}&game=${gameType}`}
                    >
                      <span>{t("entrance.tableTogether")}</span>
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
                <button type="button" className="sim-primary" onClick={next}>
                  <span>{t("common.continue")}</span>
                  <Icon name="arrow" />
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <span className="eyebrow">{t("entrance.eyebrowFriends").toUpperCase()}</span>
            <h1 style={{ fontSize: 48 }}>
              {t("entrance.heroFriendsLine1")}
              <br />
              {t("entrance.heroFriendsLine2")} <em>{t("entrance.heroFriendsEmphasis")}</em>
            </h1>
            <form
              className="entrance-form"
              onSubmit={(e) => {
                e.preventDefault();
                void enter("create");
              }}
            >
              <button
                className="back-button"
                type="button"
                onClick={() => setFriends(false)}
              >
                {t("entrance.backToApartment")}
              </button>
              <label>
                {t("entrance.yourName")}
                <input
                  autoFocus
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
