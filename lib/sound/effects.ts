/**
 * Table sound effects through the Web Audio API.
 *
 * Each effect is fetched and decoded once, then played from memory on a
 * shared AudioContext, so it starts within a few milliseconds and can
 * overlap itself (quick pawn hops). The previous <audio> elements had to
 * spin up — and the dice created a new element, fetching the file, on every
 * roll — which left sounds audibly behind the animation, worst in the iOS
 * web view.
 *
 * Browsers start an AudioContext suspended until the player interacts, and
 * iOS can suspend it again (backgrounding, a phone call), so every tap or
 * key press resumes it. Background music stays an <audio> element: it's long
 * and streamed, and a moment's start-up delay doesn't matter there.
 */
export type SoundEffect = "diceRoll" | "diceSix" | "pawnHop" | "pawnHome";

const SOURCES: Record<SoundEffect, string> = {
  diceRoll: "/sounds/dice-roll.wav",
  diceSix: "/audio/dice-six.wav",
  pawnHop: "/audio/ludo_piece_hopping_v2.wav",
  pawnHome: "/audio/piece-home.wav",
};

let context: AudioContext | null = null;
let loading: Promise<void> | null = null;
const buffers = new Map<SoundEffect, AudioBuffer>();

function audioContext() {
  if (context) return context;
  if (typeof window === "undefined") return null;
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  context = new Context({ latencyHint: "interactive" });
  return context;
}

function resume() {
  const ctx = context;
  if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
  void ctx.resume().catch(() => {});
  // iOS only fully unlocks output once something starts inside a gesture.
  const silence = ctx.createBufferSource();
  silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  silence.connect(ctx.destination);
  silence.start();
}

let unlockInstalled = false;
function installUnlock() {
  if (unlockInstalled) return;
  unlockInstalled = true;
  const options = { capture: true, passive: true };
  for (const type of ["pointerdown", "touchend", "keydown"]) window.addEventListener(type, resume, options);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resume();
  });
}

/** Fetches and decodes every effect once. Safe to call repeatedly. */
export function preloadSoundEffects(): Promise<void> {
  const ctx = audioContext();
  if (!ctx) return Promise.resolve();
  installUnlock();
  loading ??= Promise.all(
    (Object.entries(SOURCES) as [SoundEffect, string][]).map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
      } catch {
        // A missing effect just stays silent.
      }
    }),
  ).then(() => {});
  return loading;
}

/**
 * Plays an effect right away. Returns a function that stops it (e.g. when a
 * newer roll replaces it or sound is switched off). A no-op until the
 * effects have loaded.
 */
export function playSoundEffect(name: SoundEffect, volume = 1): () => void {
  const ctx = context;
  const buffer = buffers.get(name);
  if (!ctx || !buffer) return () => {};
  if (ctx.state !== "running") resume();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(ctx.destination);
  source.start();
  return () => {
    try {
      source.stop();
    } catch {
      // Already finished.
    }
  };
}
