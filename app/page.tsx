"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { createRoom, joinRoom } from "@/lib/supabase/rpc";

export default function Home() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [pending, setPending] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <h1 className="text-headline-lg tracking-tight text-foreground">Ludo Rivals</h1>
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

      {error && (
        <p role="alert" className="text-center text-body-sm text-quadrant-red">
          {error}
        </p>
      )}
    </main>
  );
}
