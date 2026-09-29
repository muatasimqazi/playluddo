import { DEFAULT_ROOM_RULES, resolveRoomRules } from "./rules";
import type { RoomRules } from "./types";

/**
 * The named sets of house rules a host starts from, and which combinations
 * the server will accept (docs/COMPETITIVE_ROADMAP.md F2.4, decision 14).
 *
 * This mirrors private.ludo_rule_presets() and private.ludo_allowed_rule_sets()
 * so the panel can grey out what the server would refuse, with the server
 * still the one that decides. tests/parity keeps the two in step.
 */

/** The rules the allow-list governs. The rest combine freely. */
export const COMBINATION_KEYS = [
  "bonusRollOnFinish",
  "startOnBoard",
  "pawnsToWin",
  "captureToEnterHome",
  "blockades",
  "turnSeconds",
] as const;

export type PresetName = "classic" | "quick" | "master" | "family";

type Combination = Pick<RoomRules, (typeof COMBINATION_KEYS)[number]>;

function combination(rules: Partial<RoomRules> | null | undefined): Combination {
  const resolved = resolveRoomRules(rules);
  return {
    bonusRollOnFinish: resolved.bonusRollOnFinish,
    startOnBoard: resolved.startOnBoard,
    pawnsToWin: resolved.pawnsToWin,
    captureToEnterHome: resolved.captureToEnterHome,
    blockades: resolved.blockades,
    turnSeconds: resolved.turnSeconds,
  };
}

const CLASSIC = combination(null);

export const RULE_PRESETS: Record<PresetName, Combination> = {
  classic: CLASSIC,
  quick: { ...CLASSIC, startOnBoard: 1, pawnsToWin: 2 },
  master: { ...CLASSIC, captureToEnterHome: true },
  family: { ...CLASSIC, turnSeconds: 30 },
};

export const PRESET_LABELS: Record<PresetName, { name: string; note: string }> = {
  classic: { name: "Classic", note: "The game as everyone knows it" },
  quick: { name: "Quick", note: "One piece out to start, two home to win" },
  master: { name: "Master", note: "Capture someone before any piece goes home" },
  family: { name: "Family", note: "Thirty seconds a turn, so nobody feels rushed" },
};

/** Classic with exactly one thing changed, alongside the presets. */
const SINGLE_CHANGES: Partial<Combination>[] = [
  { blockades: true },
  { bonusRollOnFinish: false },
  { turnSeconds: 10 },
  { turnSeconds: 30 },
];

export const ALLOWED_COMBINATIONS: Combination[] = [
  ...Object.values(RULE_PRESETS),
  ...SINGLE_CHANGES.map((change) => ({ ...CLASSIC, ...change })),
];

function same(a: Combination, b: Combination) {
  return COMBINATION_KEYS.every((key) => a[key] === b[key]);
}

/** Whether the server would accept these rules. */
export function rulesAllowed(rules: Partial<RoomRules> | null | undefined): boolean {
  const wanted = combination(rules);
  return ALLOWED_COMBINATIONS.some((allowed) => same(allowed, wanted));
}

/** The preset these rules match, if any. */
export function presetOf(rules: Partial<RoomRules> | null | undefined): PresetName | null {
  const wanted = combination(rules);
  return (
    (Object.keys(RULE_PRESETS) as PresetName[]).find((name) => same(RULE_PRESETS[name], wanted)) ?? null
  );
}

/** One line describing what the table is playing. */
export function describeRules(rules: Partial<RoomRules> | null | undefined, gameType: string): string {
  const r = resolveRoomRules(rules);
  const parts: string[] = [];
  if (gameType === "ludo") {
    const preset = presetOf(rules);
    parts.push(preset ? PRESET_LABELS[preset].name : "House rules");
    if (r.pawnsToWin < 4) parts.push(`first to get ${r.pawnsToWin} home`);
    if (r.startOnBoard > 0) parts.push(`${r.startOnBoard} out to start`);
    if (r.captureToEnterHome) parts.push("capture before going home");
    if (r.blockades) parts.push("blockades on");
    if (!r.bonusRollOnFinish) parts.push("no extra roll for getting home");
  } else {
    parts.push("Snakes & Ladders");
    if (r.snakesAnyRollToStart) parts.push("any roll to start");
    if (r.snakesBounceBack) parts.push("bounce back off 100");
  }
  parts.push(`${r.turnSeconds}s a turn`);
  if (r.matchMinutes > 0) parts.push(`${r.matchMinutes}-minute match`);
  return parts.join(" · ");
}

export { DEFAULT_ROOM_RULES };
