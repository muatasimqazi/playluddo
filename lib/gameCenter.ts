import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  leaderboards: { wins: "com.luddohouse.wins" },
  achievements: {
    firstWin: "com.luddohouse.first_win",
    ludoWin: "com.luddohouse.ludo_win",
    snakesWin: "com.luddohouse.snakes_win",
    onlineWin: "com.luddohouse.online_win",
    tenWins: "com.luddohouse.ten_wins",
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

// A local tally alongside Game Center's own, so a win reported while offline
// or before the leaderboard existed isn't lost from the running total.
const LOCAL_WINS_KEY = "luddo-gc-wins";

function localWins() {
  try {
    return Number(localStorage.getItem(LOCAL_WINS_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Records a win: bumps the Wins leaderboard (a running total) and reports the
 * matching achievements. `online` is any table played over the network
 * (friends or quick match), as opposed to offline practice.
 */
export async function recordGameCenterWin({
  gameType,
  online,
}: {
  gameType: "ludo" | "snakes_and_ladders";
  online: boolean;
}) {
  if (!(await signInToGameCenter())) return;
  const leaderboardId = GAME_CENTER.leaderboards.wins;
  const reported = await GameCenter.getScore({ leaderboardId })
    .then((result) => result.score)
    .catch(() => 0);
  const total = Math.max(reported, localWins()) + 1;
  try {
    localStorage.setItem(LOCAL_WINS_KEY, String(total));
  } catch {
    // The tally is a convenience; Game Center keeps the real score.
  }
  const { achievements } = GAME_CENTER;
  const reports: Promise<void>[] = [
    GameCenter.submitScore({ leaderboardId, score: total }),
    GameCenter.reportAchievement({ achievementId: achievements.firstWin }),
    GameCenter.reportAchievement({
      achievementId: gameType === "ludo" ? achievements.ludoWin : achievements.snakesWin,
    }),
    GameCenter.reportAchievement({
      achievementId: achievements.tenWins,
      percentComplete: Math.min(100, total * 10),
    }),
  ];
  if (online) reports.push(GameCenter.reportAchievement({ achievementId: achievements.onlineWin }));
  await Promise.allSettled(reports);
}

/** Opens Apple's Game Center leaderboard screen (signing in first if needed). */
export async function showGameCenterLeaderboard() {
  if (!(await signInToGameCenter())) return false;
  return GameCenter.showLeaderboard({ leaderboardId: GAME_CENTER.leaderboards.wins })
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
