"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { createRoom, joinRoom } from "@/lib/supabase/rpc";

// The three ways into a match, per direct instruction — this pass only
// adds the entry points and their copy; the two "comingSoon" modes have
// no logic behind them yet ("we will then build each of these
// features"). Reworded from the original rough labels for parallel,
// action-first phrasing (a verb + who you're playing) and a subtitle
// that says what actually happens, not just a parenthetical restating
// the title.
type PlayMode = "online" | "friends" | "computer";

const PLAY_MODES: readonly {
  mode: PlayMode;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
}[] = [
  {
    mode: "online",
    title: "Play Online",
    subtitle: "Get matched with other players looking for a game",
    comingSoon: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6} stroke="currentColor" className="h-6 w-6">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.2 3.4 8.5s-1.2 6.2-3.4 8.5c-2.2-2.3-3.4-5.2-3.4-8.5S9.8 5.8 12 3.5Z" />
      </svg>
    ),
  },
  {
    mode: "friends",
    title: "Play with Friends",
    subtitle: "Start a private room and invite them with a code",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6} stroke="currentColor" className="h-6 w-6">
        <circle cx="8.5" cy="8.5" r="3" />
        <path d="M2.5 19c.7-3.2 3-4.9 6-4.9s5.3 1.7 6 4.9" />
        <circle cx="16.5" cy="8" r="2.4" />
        <path d="M15 14.3c2.6.2 4.4 1.9 5 4.7" />
      </svg>
    ),
  },
  {
    mode: "computer",
    title: "Vs Computer",
    subtitle: "Practice a match against computer-controlled opponents",
    comingSoon: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.6} stroke="currentColor" className="h-6 w-6">
        <rect x="5" y="5" width="14" height="14" rx="2.5" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
        <path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" />
      </svg>
    ),
  },
];

export default function Home() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which option the player has drilled into — only "friends" has a
  // built flow behind it right now, so this is the only mode selecting
  // a card actually changes.
  const [selectedMode, setSelectedMode] = useState<PlayMode | null>(null);

  async function handleCreate() {
    if (!displayName.trim()) {
      setError("Enter a display name first.");
      return;
    }
    setPending("create");
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      const { roomId } = await createRoom(client, displayName.trim());
      router.push(`/room/${roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPending(null);
    }
  }

  async function handleJoin() {
    if (!displayName.trim() || !joinCode.trim()) {
      setError("Enter a display name and room code.");
      return;
    }
    setPending("join");
    setError(null);
    try {
      const client = createClient();
      await ensureSession(client);
      const { roomId } = await joinRoom(client, joinCode.trim(), displayName.trim());
      router.push(`/room/${roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPending(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-headline-lg tracking-tight text-foreground">Let&apos;s Play Luddo</h1>
        <p className="text-body-md text-text-secondary">Fast online Ludo with friends and rivals.</p>
      </div>

      <label className="flex flex-col gap-1 text-body-sm text-foreground">
        Display name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={24}
          className="rounded-md border border-hairline px-3 py-2 text-body-md shadow-elevation-1"
          placeholder="Alex"
        />
      </label>

      {selectedMode === null && (
        <div className="flex flex-col gap-3">
          {PLAY_MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => setSelectedMode(option.mode)}
              disabled={option.comingSoon}
              className="flex items-center gap-3 rounded-xl border border-hairline bg-surface p-3 text-left shadow-elevation-1 transition-transform active:scale-97 disabled:opacity-50 disabled:active:scale-100"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container text-foreground">
                {option.icon}
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-label-lg text-foreground">{option.title}</span>
                  {option.comingSoon && (
                    <span className="rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-text-muted">
                      Coming soon
                    </span>
                  )}
                </span>
                <span className="block text-body-sm text-text-secondary">{option.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedMode === "friends" && (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setSelectedMode(null)}
            className="self-start text-body-sm text-action"
          >
            ← Back
          </button>

          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void handleCreate()}
            className="h-12.5 rounded-md bg-action text-label-lg text-white shadow-elevation-2 transition-transform active:scale-97 disabled:opacity-50"
          >
            {pending === "create" ? "Creating…" : "Create Private Room"}
          </button>

          <div className="flex items-center gap-2 text-label-sm text-text-muted" aria-hidden>
            <div className="h-px flex-1 bg-hairline" /> or <div className="h-px flex-1 bg-hairline" />
          </div>

          <label className="flex flex-col gap-1 text-body-sm text-foreground">
            Room code
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="rounded-md border border-hairline px-3 py-2 text-body-md uppercase tracking-wide shadow-elevation-1"
              placeholder="ABC123"
            />
          </label>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void handleJoin()}
            className="h-12.5 rounded-md border border-hairline bg-white text-label-lg text-foreground transition-transform active:scale-97 disabled:opacity-50"
          >
            {pending === "join" ? "Joining…" : "Join Room"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-body-sm text-quadrant-red">
          {error}
        </p>
      )}
    </main>
  );
}
