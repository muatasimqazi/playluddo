"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { createRoom, joinRoom, setPlayerColor, setRoomGame } from "@/lib/supabase/rpc";
import type { GameType, PlayerColor } from "@/lib/board/types";
import { COLORS } from "@/lib/presentation/board";
import { AVATARS } from "@/lib/avatars/catalog";
import { usePreloadBoardScene } from "@/lib/presentation/preloadScene";
import {
  setPreferredBoardStyle,
  type BoardStyle,
} from "@/lib/presentation/simulatorPrefs";
import { Icon } from "@/components/simulator/Icon";
import { ProfilePanel } from "@/components/auth/ProfilePanel";
import type { Team } from "@/lib/supabase/teams";
import { BRAND } from "@/lib/brand";
import "@/components/simulator/simulator.css";

// Matches the seat_index a color maps to server-side (private.ludo_color_for_seat /
// set_player_color), same order as components/lobby/RoomLobby.tsx's SEAT_COLORS.
const SEAT_COLORS: PlayerColor[] = ["red", "green", "yellow", "blue"];

// Same four styles/descriptions as the in-game "Board design" panel
// (components/simulator/Simulator.tsx) — choosing one here just seeds
// that same saved preference before the first game ever starts.
const BOARD_STYLES: { value: BoardStyle; label: string; desc: string }[] = [
  { value: "signature", label: "Signature", desc: "The Luddo House artwork" },
  { value: "classic", label: "Classic", desc: "A traditional printed board" },
  { value: "geometric", label: "Geometric", desc: "Bold shapes, gold accents" },
  { value: "aladdin", label: "Aladdin", desc: "An Arabian-nights table" },
];

// One fieldset visible at a time instead of a long scroll — "board" only
// applies to Ludo's skins, so it drops out of the sequence entirely for
// Snakes & Ladders rather than showing empty or irrelevant.
type StepId = "game" | "players" | "base" | "avatar" | "board" | "start";
const LUDO_STEPS: StepId[] = ["game", "players", "base", "avatar", "board", "start"];
const SNAKES_STEPS: StepId[] = ["game", "players", "base", "avatar", "start"];

export default function Home() {
  const router = useRouter();
  const [friends, setFriends] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [gameType, setGameType] = useState<GameType>("ludo");
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  // Must stay valid for the default playerCount (2): a seat's color maps
  // 1:1 to its index (red=0 ... blue=3), and red (seat 0) is the only
  // choice guaranteed in range for every possible player count.
  const [playerColor, setPlayerColorChoice] = useState<PlayerColor>("red");
  const [playerAvatar, setPlayerAvatar] = useState<string>(AVATARS[0].id);
  const [boardStyle, setBoardStyleChoice] = useState<BoardStyle>("signature");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
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
      setError("What should we call you at the table?");
      return;
    }
    if (kind === "join" && !code.trim()) {
      setError("Enter the room code your friend shared.");
      return;
    }
    setPending(kind);
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      const room =
        kind === "create"
          ? await createRoom(client, name.trim(), undefined, playerCount)
          : await joinRoom(client, code.trim(), name.trim());
      if (kind === "create" && playerColor !== "red")
        await setPlayerColor(client, room.roomId, playerColor);
      if (kind === "create" && gameType !== "ludo")
        await setRoomGame(client, room.roomId, gameType);
      router.push(`/room?id=${room.roomId}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not connect. Please try again.",
      );
      setPending(null);
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
      setError("What should we call you at the table?");
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
      setError(
        e instanceof Error ? e.message : "Could not connect. Please try again.",
      );
      setPending(null);
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
          <span>A LITTLE CLOSER TOGETHER.</span>
          <Link className="profile-trigger leaderboard-trigger" href="/leaderboard">
            <Icon name="trophy" />
            <small>Leaderboard</small>
          </Link>
          <ProfilePanel onNameChange={setName} onTeamsChange={setTeams} />
        </div>
      </header>
      <section className="entrance-content">
        {!friends ? (
          <>
            <span className="eyebrow">MAKE YOURSELF AT HOME</span>
            <h1>
              A familiar game.
              <br />A whole new
              <br />
              <em>place to play.</em>
            </h1>
            <p>
              Pull up a chair. Roll the dice. Share a table with friends,
              wherever the evening finds you.
            </p>
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
                <fieldset className="entrance-game-choice">
                  <legend>Choose your game</legend>
                  <div>
                    <button
                      type="button"
                      className={gameType === "ludo" ? "is-selected" : ""}
                      aria-pressed={gameType === "ludo"}
                      onClick={() => setGameType("ludo")}
                    >
                      <strong>Ludo</strong>
                      <span>Roll a six, race four pieces home</span>
                    </button>
                    <button
                      type="button"
                      className={
                        gameType === "snakes_and_ladders" ? "is-selected" : ""
                      }
                      aria-pressed={gameType === "snakes_and_ladders"}
                      onClick={() => setGameType("snakes_and_ladders")}
                    >
                      <strong>Snakes & Ladders</strong>
                      <span>Climb ladders, dodge snakes, reach 100</span>
                    </button>
                  </div>
                </fieldset>
              )}
              {currentStep === "players" && (
                <fieldset className="entrance-player-count">
                  <legend>How many players?</legend>
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
                          {count === 2 ? "You + 1" : `You + ${count - 1}`}
                        </span>
                      </button>
                    ))}
                  </div>
                  <small>Open seats can be friends or computer players.</small>
                </fieldset>
              )}
              {currentStep === "base" && (
                <fieldset className="entrance-color-choice">
                  <legend>Choose your base</legend>
                  <div>
                    {(playerCount === 2
                      ? SEAT_COLORS
                      : SEAT_COLORS.slice(0, playerCount)
                    ).map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={playerColor === color ? "is-selected" : ""}
                        aria-label={`${color} base`}
                        aria-pressed={playerColor === color}
                        onClick={() => setPlayerColorChoice(color)}
                      >
                        <i style={{ background: COLORS[color] }} />
                        {color}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              {currentStep === "avatar" && (
                <fieldset className="entrance-avatar-choice">
                  <legend>Choose your avatar</legend>
                  <div>
                    {AVATARS.map((avatar) => (
                      <button
                        key={avatar.id}
                        type="button"
                        className={
                          playerAvatar === avatar.id ? "is-selected" : ""
                        }
                        aria-label={avatar.label}
                        aria-pressed={playerAvatar === avatar.id}
                        onClick={() => setPlayerAvatar(avatar.id)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- local pre-optimized WebP thumbnails. */}
                        <img src={avatar.portrait} alt="" />
                      </button>
                    ))}
                  </div>
                  <small>Sign in from your profile to keep a photo avatar.</small>
                </fieldset>
              )}
              {currentStep === "board" && (
                <fieldset className="entrance-board-choice">
                  <legend>Choose your board design</legend>
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
                    ← Back
                  </button>
                  {teams.length > 0 && (
                    <div className="entrance-team-card">
                      {teams.map((team) => (
                        <div key={team.id} className="entrance-team-row">
                          <div>
                            <span className="eyebrow">YOUR TEAM</span>
                            <strong>{team.name}</strong>
                            <small>
                              {team.members.length}{" "}
                              {team.members.length === 1 ? "member" : "members"}
                              {team.activeRoom &&
                                ` · Table open · ${team.activeRoom.seatsTaken}/4 seated`}
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
                              {team.activeRoom ? "Join now" : "Start a table"}
                            </span>
                            <Icon name="arrow" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="entrance-buttons">
                    <button
                      className="sim-primary"
                      onClick={() => setFriends(true)}
                    >
                      <span>Play with friends</span>
                      <Icon name="arrow" />
                    </button>
                    <Link
                      className="entrance-secondary"
                      href={`/practice?players=${playerCount}&color=${playerColor}&avatar=${playerAvatar}&game=${gameType}`}
                    >
                      <span>Settle in with an offline practice game</span>
                      <Icon name="dice" />
                    </Link>
                    <Link
                      className="entrance-secondary"
                      href={`/table-together?players=${playerCount}&game=${gameType}`}
                    >
                      <span>Table Together · Offline, share this screen</span>
                      <Icon name="users" />
                    </Link>
                  </div>
                  <p className="entrance-caption">
                    Up to four players · A shared 3D table · No download
                  </p>
                </>
              )}
            </div>
            {currentStep !== "start" && (
              <div className="entrance-wizard-nav">
                {step > 0 && (
                  <button type="button" className="back-button" onClick={back}>
                    ← Back
                  </button>
                )}
                <button type="button" className="sim-primary" onClick={next}>
                  <span>Continue</span>
                  <Icon name="arrow" />
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <span className="eyebrow">GOOD COMPANY STARTS HERE</span>
            <h1 style={{ fontSize: 48 }}>
              A seat
              <br />
              for <em>everyone.</em>
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
                ← Back to the apartment
              </button>
              <label>
                Your name
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  placeholder="How should we call you?"
                  autoComplete="nickname"
                />
              </label>
              <button className="sim-primary" disabled={pending !== null}>
                {pending === "create"
                  ? "Preparing your room…"
                  : "Create a private table"}
                <Icon name="arrow" />
              </button>
              <span className="form-divider">Already have an invitation?</span>
              <label>
                Room code
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="ABC123"
                  autoComplete="off"
                />
              </label>
              <button
                className="entrance-secondary"
                type="button"
                disabled={pending !== null}
                onClick={() => void enter("join")}
              >
                {pending === "join"
                  ? "Finding your friends…"
                  : "Join their table"}
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
        <span>CLASSIC MEETS MODERN</span>
        <p>{BRAND.name}</p>
      </div>
      <footer className="entrance-footer">
        <span>{BRAND.tagline.toUpperCase()}. SHARED MOMENTS.</span>
        <span>
          <i className="connection-dot" />
          TAKE YOUR TIME. STAY A WHILE.
        </span>
      </footer>
    </main>
  );
}
