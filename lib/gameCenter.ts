import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getMyWins } from "@/lib/supabase/leaderboard";

/**
 * Game Center, iOS app only (native plugin: ios/App/App/GameCenterPlugin.swift).
 * Everything here is a no-op on the web and Android, and every call swallows
 * failures — a player who isn't signed in to Game Center, or an ID not yet set
 * up in App Store Connect, must never affect the game.
 *
 * The IDs below must match the leaderboard and achievements created in
 * App Store Connect → Luddo House → Features → Game Center.
 */
export const GAME_CENTER = {
  leaderboards: {
    // Historical all-wins board (kept as-is; it holds past offline scores that
    // can't be removed). No longer written to -- see decision 17.
    wins: "com.luddohouse.wins",
    // Online wins only, going forward (F3.4, decision 17).
    onlineWins: "com.luddohouse.online_wins",
  },
  achievements: {
    // Any online win, reported alongside the server-unlocked ones below.
    onlineWin: "com.luddohouse.online_win",
  },
} as const;

/** Apple-signed identity proof (GKLocalPlayer.fetchItems(forIdentityVerificationSignature:)). */
interface IdentityProof {
  publicKeyUrl: string;
  signature: string;
  salt: string;
  timestamp: number;
  teamPlayerId: string;
  bundleId: string;
  displayName: string;
}

interface GameCenterPlugin {
  authenticate(): Promise<{ authenticated: boolean; playerId?: string; displayName?: string; error?: string }>;
  identityProof(): Promise<IdentityProof>;
  submitScore(options: { leaderboardId: string; score: number }): Promise<void>;
  getScore(options: { leaderboardId: string }): Promise<{ score: number }>;
  reportAchievement(options: { achievementId: string; percentComplete?: number }): Promise<void>;
  showLeaderboard(options?: { leaderboardId?: string }): Promise<void>;
  showAchievements(): Promise<void>;
}

const GameCenter = registerPlugin<GameCenterPlugin>("GameCenter");

export function gameCenterAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

let signIn: Promise<boolean> | null = null;

/** Signs the local player in once per launch (Apple shows its own banner or sheet). */
export function signInToGameCenter(): Promise<boolean> {
  if (!gameCenterAvailable()) return Promise.resolve(false);
  signIn ??= GameCenter.authenticate()
    .then((result) => result.authenticated)
    .catch(() => false);
  return signIn;
}

/**
 * Signs in to the player's Luddo House account with their Game Center
 * identity (iOS only): the Apple-signed proof is checked by the
 * game-center-sign-in Edge Function, which returns a one-time token for a
 * normal Supabase session. The first sign-in creates the account. Returns an
 * error message to show, or null on success.
 */
export async function signInWithGameCenter(client: SupabaseClient): Promise<string | null> {
  if (!(await signInToGameCenter())) {
    return "Sign in to Game Center in the Settings app first, then try again.";
  }
  let proof: IdentityProof;
  try {
    proof = await GameCenter.identityProof();
  } catch {
    return "Game Center couldn't confirm who you are. Try again in a moment.";
  }
  const { displayName, ...signed } = proof;
  const { data, error } = await client.functions.invoke<{ tokenHash: string }>("game-center-sign-in", {
    body: { proof: signed, displayName },
  });
  if (error || !data?.tokenHash) return "Couldn't sign in with Game Center. Try again in a moment.";
  const { error: verifyError } = await client.auth.verifyOtp({ token_hash: data.tokenHash, type: "magiclink" });
  return verifyError ? verifyError.message : null;
}

/**
 * Mirrors the signed-in account's server-confirmed online results to Game
 * Center after a match (iOS only; no-op elsewhere). Per decision 17, only
 * online results are mirrored, and offline practice never reports here.
 *
 * Everything is server truth: the online-wins total comes from the account's
 * recorded wins, and the achievements are the ones the server has unlocked
 * (get_game_center_unlocks). Game Center ignores duplicate reports, so this is
 * safe to call after every match. Guests (no account) mirror nothing.
 */
export async function mirrorGameCenterOnlineResults() {
  if (!(await signInToGameCenter())) return;
  const client = createClient();
  const wins = await getMyWins(client).catch(() => 0);
  const { data } = await client.rpc("get_game_center_unlocks");
  const gcIds = Array.isArray(data) ? (data as string[]) : [];

  const reports: Promise<void>[] = [
    GameCenter.submitScore({ leaderboardId: GAME_CENTER.leaderboards.onlineWins, score: wins }),
    ...gcIds.map((achievementId) => GameCenter.reportAchievement({ achievementId })),
  ];
  if (wins >= 1)
    reports.push(GameCenter.reportAchievement({ achievementId: GAME_CENTER.achievements.onlineWin }));
  await Promise.allSettled(reports);
}

/** Opens Apple's Game Center leaderboard screen (signing in first if needed). */
export async function showGameCenterLeaderboard() {
  if (!(await signInToGameCenter())) return false;
  return GameCenter.showLeaderboard({ leaderboardId: GAME_CENTER.leaderboards.onlineWins })
    .then(() => true)
    .catch(() => false);
}

/** Opens Apple's Game Center achievements screen (signing in first if needed). */
export async function showGameCenterAchievements() {
  if (!(await signInToGameCenter())) return false;
  return GameCenter.showAchievements()
    .then(() => true)
    .catch(() => false);
}
