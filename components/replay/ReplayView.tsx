"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/auth";
import { getMatchTranscript } from "@/lib/supabase/replay";
import { buildReplay, type Replay, type ReplayStep } from "@/lib/presentation/replay";
import type { PresentationFrame } from "@/lib/presentation/timeline";
import { mediaRecordingSupported, recordHighlight, shareClip } from "@/lib/presentation/clip";
import { Icon } from "@/components/simulator/Icon";
import { TableLoading } from "@/components/simulator/TableLoading";
import "@/components/simulator/simulator.css";

const Scene = dynamic(() => import("@/components/simulator/SimulatorScene"), {
  ssr: false,
  loading: () => <TableLoading label="Loading the replay" />,
});

// One beat per step; rolls flick past, moves get room to land.
function stepMs(step: ReplayStep, speed: number): number {
  const base = step.kind === "roll" ? 650 : step.kind === "start" ? 400 : 1050;
  return base / speed;
}

function frameFor(replay: Replay, index: number): PresentationFrame {
  const step = replay.steps[index];
  // The die shows the last value rolled; bump rollId only on a roll so the die
  // tumbles then, not on every step.
  let rollId = 0;
  for (let i = 0; i <= index; i++) if (replay.steps[i].kind === "roll") rollId += 1;
  return {
    pawns: step.pawns,
    dice: step.dice ?? 1,
    rollId,
    actorId: step.actorId,
    busy: false,
    replaying: true,
    phase: "idle",
    move: step.move,
    canReplay: false,
    // Constant so pieces persist across steps and animate their hop.
    revision: 1,
  };
}

export function ReplayView({ matchId }: { matchId: string }) {
  const client = useMemo(() => createClient(), []);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [clipState, setClipState] = useState<"idle" | "recording" | "sharing">("idle");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        await ensureSession(client);
        const transcript = await getMatchTranscript(client, matchId);
        if (!cancelled) {
          setReplay(buildReplay(transcript));
          setPlaying(true);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load this replay.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, matchId]);

  const steps = replay?.steps ?? [];
  const atEnd = index >= steps.length - 1;

  // The playback clock: advance one step, then schedule the next by its length.
  useEffect(() => {
    if (!playing || !replay || atEnd) return;
    const timer = window.setTimeout(
      () => setIndex((i) => Math.min(i + 1, replay.steps.length - 1)),
      stepMs(replay.steps[index], speed),
    );
    return () => window.clearTimeout(timer);
  }, [playing, replay, index, speed, atEnd]);

  async function saveHighlight() {
    if (!replay || clipState !== "idle") return;
    const canvas = rootRef.current?.querySelector("canvas");
    if (!canvas) return;
    setPlaying(true);
    setClipState("recording");
    try {
      const blob = await recordHighlight({
        source: canvas,
        durationMs: 8000,
        caption: steps[index]?.caption ?? "Highlight",
      });
      setClipState("sharing");
      await shareClip(blob, steps[index]?.caption ?? "Highlight");
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError"))
        setError(err instanceof Error ? err.message : "Could not save the highlight.");
    } finally {
      setClipState("idle");
    }
  }

  if (error)
    return (
      <div className="replay-message" role="alert">
        <p>{error}</p>
        <Link href="/" className="sim-primary">
          Back to the apartment
        </Link>
      </div>
    );
  if (!replay) return <TableLoading label="Loading the replay" />;

  const step = steps[index];
  const frame = frameFor(replay, index);

  return (
    <main className="simulator replay-simulator" ref={rootRef}>
      <Scene
        loadingLabel="Loading the replay"
        gameType={replay.gameType}
        snakesBoard={0}
        frame={frame}
        players={replay.players}
        myPlayerId={null}
        turnPlayerId={step.actorId}
        legalPawnIds={[]}
        canRoll={false}
        view="table"
        mode="play"
        orientation={0}
        quality="high"
        actionCamera="subtle"
        resetKey={0}
        onRotate={() => {}}
        onRoll={() => {}}
        onMove={() => {}}
        soundEnabled={false}
        boardStyle="signature"
      />

      <header className="replay-top">
        <Link href="/" className="replay-exit" aria-label="Leave the replay">
          <Icon name="arrow" style={{ transform: "rotate(180deg)" }} />
        </Link>
        <span className="replay-tag">REPLAY</span>
      </header>

      <div className="replay-caption" role="status" aria-live="polite">
        {step.caption}
      </div>

      <footer className="replay-controls">
        <div className="replay-buttons">
          <button
            type="button"
            aria-label="Restart"
            onClick={() => {
              setIndex(0);
              setPlaying(true);
            }}
          >
            <Icon name="replay" />
          </button>
          <button
            type="button"
            className="replay-play"
            aria-label={playing ? "Pause" : atEnd ? "Watch again" : "Play"}
            onClick={() => {
              if (atEnd) setIndex(0);
              setPlaying((p) => !p || atEnd);
            }}
          >
            <Icon name={playing && !atEnd ? "pause" : "play"} />
          </button>
          <button
            type="button"
            className="replay-speed"
            aria-label="Playback speed"
            onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))}
          >
            {speed}×
          </button>
          {mediaRecordingSupported() && (
            <button
              type="button"
              className="replay-clip"
              onClick={() => void saveHighlight()}
              disabled={clipState !== "idle"}
            >
              <Icon name="share" size={15} />
              {clipState === "recording"
                ? "Recording…"
                : clipState === "sharing"
                  ? "Saving…"
                  : "Save clip"}
            </button>
          )}
        </div>

        <input
          className="replay-scrubber"
          type="range"
          min={0}
          max={steps.length - 1}
          value={index}
          aria-label="Scrub through the match"
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
        />
        <div className="replay-count">
          {index + 1} / {steps.length}
        </div>
      </footer>
    </main>
  );
}
