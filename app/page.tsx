"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { createRoom, joinRoom } from "@/lib/supabase/rpc";
import { createPractice } from "@/lib/presentation/practice";
import { Icon } from "@/components/simulator/Icon";
import "@/components/simulator/simulator.css";

const Scene = dynamic(() => import("@/components/simulator/SimulatorScene"), {
  ssr: false,
});

export default function Home() {
  const router = useRouter();
  const [friends, setFriends] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => createPractice().state, []);
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
      router.push(`/room/${room.roomId}`);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not connect. Please try again.",
      );
      setPending(null);
    }
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
        <span>A LITTLE CLOSER TOGETHER.</span>
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
            <div className="entrance-buttons">
              <button className="sim-primary" onClick={() => setFriends(true)}>
                <span>Play with friends</span>
                <Icon name="arrow" />
              </button>
              <Link className="entrance-secondary" href="/practice">
                <span>Settle in with a practice game</span>
                <Icon name="dice" />
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
        <p>Let's Play LUDDO</p>
      </div>
      <footer className="entrance-footer">
        <span>CLASSIC LUDO. SHARED MOMENTS.</span>
        <span>
          <i className="connection-dot" />
          TAKE YOUR TIME. STAY A WHILE.
        </span>
      </footer>
    </main>
  );
}
