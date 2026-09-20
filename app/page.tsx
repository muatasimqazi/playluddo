"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { createRoom, joinRoom, setPlayerColor } from "@/lib/supabase/rpc";
import { createPractice } from "@/lib/presentation/practice";
import type { PlayerColor } from "@/lib/board/types";
import { COLORS } from "@/lib/presentation/board";
import { Icon } from "@/components/simulator/Icon";
import { ProfilePanel } from "@/components/auth/ProfilePanel";
import { TableLoading } from "@/components/simulator/TableLoading";
import type { Team } from "@/lib/supabase/teams";
import "@/components/simulator/simulator.css";

const Scene = dynamic(() => import("@/components/simulator/SimulatorScene"), {
  ssr: false,
  loading: () => <TableLoading label="Setting the table…" />,
});

export default function Home() {
  const router = useRouter();
  const [friends, setFriends] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  const [playerColor, setPlayerColorChoice] = useState<PlayerColor>("blue");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const preview = useMemo(
    () => createPractice("ludo", playerCount, playerColor).state,
    [playerCount, playerColor],
  );
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
          ? await createRoom(client, name.trim())
          : await joinRoom(client, code.trim(), name.trim());
      if (kind === "create" && playerColor !== "red")
        await setPlayerColor(client, room.roomId, playerColor);
      router.push(
        kind === "create"
          ? `/room/${room.roomId}?players=${playerCount}`
          : `/room/${room.roomId}`,
      );
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
      router.push(`/room/${room.roomId}`);
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
      <Scene
        frame={{
          pawns: preview.pawns,
          dice: 5,
          rollId: 0,
          actorId: null,
          busy: false,
          replaying: false,
          phase: "idle",
          move: null,
          canReplay: false,
          revision: 0,
        }}
        players={preview.players}
        myPlayerId={null}
        turnPlayerId={null}
        legalPawnIds={[]}
        canRoll={false}
        view="table"
        mode="play"
        orientation={0}
        quality="medium"
        actionCamera="off"
        resetKey={0}
        onRotate={() => {}}
        onRoll={() => {}}
        onMove={() => {}}
        preview
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
            LUDDO<small>THE TABLETOP EXPERIENCE</small>
          </span>
        </div>
        <div className="entrance-header-actions">
          <span>A LITTLE CLOSER TOGETHER.</span>
          <ProfilePanel onNameChange={setName} onTeamsChange={setTeams} />
        </div>
      </header>
      <section className="entrance-content">
        {!friends && teams.length > 0 && (
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
                  <span>{team.activeRoom ? "Join now" : "Start a table"}</span>
                  <Icon name="arrow" />
                </button>
              </div>
            ))}
          </div>
        )}
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
            <fieldset className="entrance-player-count">
              <legend>How many players?</legend>
              <div>
                {([2, 3, 4] as const).map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={playerCount === count ? "is-selected" : ""}
                    aria-pressed={playerCount === count}
                    onClick={() => setPlayerCount(count)}
                  >
                    <strong>{count}</strong>
                    <span>{count === 2 ? "You + 1" : `You + ${count - 1}`}</span>
                  </button>
                ))}
              </div>
              <small>Open seats can be friends or computer players.</small>
            </fieldset>
            <fieldset className="entrance-color-choice">
              <legend>Choose your base</legend>
              <div>
                {(["red", "green", "yellow", "blue"] as const).map(
                  (color) => (
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
                  ),
                )}
              </div>
            </fieldset>
            <div className="entrance-buttons">
              <button className="sim-primary" onClick={() => setFriends(true)}>
                <span>Play with friends</span>
                <Icon name="arrow" />
              </button>
              <Link
                className="entrance-secondary"
                href={`/practice?players=${playerCount}&color=${playerColor}`}
              >
                <span>Settle in with a practice game</span>
                <Icon name="dice" />
              </Link>
              <Link
                className="entrance-secondary"
                href={`/table-together?players=${playerCount}`}
              >
                <span>Table Together · Share this screen</span>
                <Icon name="users" />
              </Link>
            </div>
            <p className="entrance-caption">
              Up to four players · A shared 3D table · No download
            </p>
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
        <p>Let&apos;s Play LUDDO</p>
      </div>
      <footer className="entrance-footer">
        <span>CLASSIC LUDDO. SHARED MOMENTS.</span>
        <span>
          <i className="connection-dot" />
          TAKE YOUR TIME. STAY A WHILE.
        </span>
      </footer>
    </main>
  );
}
