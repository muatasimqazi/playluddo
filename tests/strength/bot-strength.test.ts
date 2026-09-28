import { expect, it } from "vitest";
import { chooseMoveForLevel, type BotLevel } from "../../lib/board/bot";
import { createPractice, practiceReducer } from "../../lib/presentation/practice";

/**
 * Computer difficulty is measured, not assumed (docs/COMPETITIVE_ROADMAP.md
 * F1.4). Seeded, so the numbers are the same on every run: full offline
 * games through the real practice reducer, with seats swapped halfway so
 * going first doesn't favour either side. About 10s, so it runs on its own:
 * `npm run test:strength`.
 */

function seeded(seed: number) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plays one game; returns the seat index of the first player home. */
function play(levels: BotLevel[], seed: number) {
  const random = seeded(seed);
  let session = createPractice("ludo", levels.length as 2 | 3 | 4, "blue");
  for (let step = 0; step < 20_000; step++) {
    const { state } = session;
    if (state.winnerIds.length > 0) return state.players.findIndex((p) => p.id === state.winnerIds[0]);
    if (state.turnPhase === "awaiting_roll") {
      session = practiceReducer(session, { type: "roll", value: 1 + Math.floor(random() * 6) });
    } else if (state.turnPhase === "awaiting_move") {
      const seat = state.players.findIndex((p) => p.id === state.turnPlayerId);
      const move = chooseMoveForLevel(levels[seat], state.legalMoves, state.pawns, random);
      session = practiceReducer(session, { type: "move", pawnId: move!.pawnId });
    } else throw new Error(`unexpected phase ${state.turnPhase}`);
  }
  throw new Error("game did not finish");
}

/** Share of games `level` wins head to head against `opponent`. */
function headToHead(level: BotLevel, opponent: BotLevel, games: number) {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const levelSeat = g % 2;
    const levels: BotLevel[] = levelSeat === 0 ? [level, opponent] : [opponent, level];
    if (play(levels, 1000 + g) === levelSeat) wins++;
  }
  return wins / games;
}

/** Share of 4-player games `level` wins against three `opponent`s, rotating its seat. */
function againstThree(level: BotLevel, opponent: BotLevel, games: number) {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    const seat = g % 4;
    const levels: BotLevel[] = [opponent, opponent, opponent, opponent];
    levels[seat] = level;
    if (play(levels, 5000 + g) === seat) wins++;
  }
  return wins / games;
}

// Thresholds sit just under the measured values, so a real regression
// fails while the seeded runs stay deterministic. Chance would be 50% head
// to head and 25% at a 4-player table.

it("Hard beats Normal head to head", () => {
  const rate = headToHead("hard", "normal", 600);
  console.log(`Hard vs Normal: ${(rate * 100).toFixed(1)}%`);
  expect(rate).toBeGreaterThanOrEqual(0.6);
}, 120_000);

it("Hard wins more than its share against three Normals", () => {
  const rate = againstThree("hard", "normal", 300);
  console.log(`Hard vs three Normals: ${(rate * 100).toFixed(1)}%`);
  expect(rate).toBeGreaterThanOrEqual(0.28);
}, 120_000);

it("Normal beats Easy head to head", () => {
  const rate = headToHead("normal", "easy", 400);
  console.log(`Normal vs Easy: ${(rate * 100).toFixed(1)}%`);
  expect(rate).toBeGreaterThanOrEqual(0.85);
}, 120_000);
