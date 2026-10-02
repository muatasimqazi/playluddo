import { afterEach, describe, expect, it, vi } from "vitest";
import { createPractice } from "../../lib/presentation/practice";
import { DEFAULT_ROOM_RULES } from "../../lib/board/rules";
import type { GameRoomState, MatchResult, RoomRules } from "../../lib/board/types";
import {
  analyticsGameType,
  endReason,
  gameModeOf,
  gameParamsFromState,
  resultParams,
  seatWon,
} from "../../lib/analytics/gameParams";
import { roomEntry, tagRoomEntry } from "../../lib/analytics/entry";
import { fakeBrowser } from "./fakeBrowser";

function luddo(rules: Partial<RoomRules> = {}, players: 2 | 3 | 4 = 4): GameRoomState {
  const state = createPractice("ludo", players).state;
  return { ...state, rules: { ...DEFAULT_ROOM_RULES, ...rules } };
}

describe("game parameters", () => {
  it("names the games Luddo and Snakes & Ladders", () => {
    expect(analyticsGameType("ludo")).toBe("luddo");
    expect(analyticsGameType("snakes_and_ladders")).toBe("snakes_ladders");
  });

  it("names one headline mode per game", () => {
    expect(gameModeOf(luddo())).toEqual({ game_mode: "classic", rules_customized: false });
    expect(gameModeOf(luddo({ startOnBoard: 1, pawnsToWin: 2 })).game_mode).toBe("quick");
    expect(gameModeOf(luddo({ captureToEnterHome: true })).game_mode).toBe("master");
    expect(gameModeOf(luddo({ turnSeconds: 30 })).game_mode).toBe("family");
    expect(gameModeOf(luddo({ blockades: true }))).toEqual({ game_mode: "custom", rules_customized: true });
    expect(gameModeOf(luddo({ matchMinutes: 10 }))).toEqual({ game_mode: "rush", rules_customized: false });
    expect(gameModeOf(luddo({ teamUp: true, matchMinutes: 10 })).game_mode).toBe("team_up");
  });

  it("calls Snakes & Ladders classic unless its options changed", () => {
    const snakes = createPractice("snakes_and_ladders", 2).state;
    expect(gameModeOf(snakes)).toEqual({ game_mode: "classic", rules_customized: false });
    expect(gameModeOf({ ...snakes, rules: { ...DEFAULT_ROOM_RULES, snakesBounceBack: true } })).toEqual({
      game_mode: "custom",
      rules_customized: true,
    });
  });

  it("describes the table without names or ids beyond the game id", () => {
    const params = gameParamsFromState(luddo(), { game_id: "local-abc", play_context: "practice", bot_difficulty: "hard" });
    expect(params).toEqual({
      game_id: "local-abc",
      game_type: "luddo",
      game_mode: "classic",
      rules_customized: false,
      play_context: "practice",
      seat_count: 4,
      human_count: 1,
      bot_count: 3,
      bot_difficulty: "hard",
      turn_timer_s: 15,
    });
  });

  it("uses the party turn timer at a party table", () => {
    const state = { ...luddo(), isParty: true, partyTurnSeconds: 45 };
    expect(gameParamsFromState(state, { game_id: "m", play_context: "party" }).turn_timer_s).toBe(45);
  });

  it("gives each practice game its own id", () => {
    const a = createPractice().id;
    const b = createPractice().id;
    expect(a).toMatch(/^local-/);
    expect(a).not.toBe(b);
  });
});

describe("results", () => {
  it("knows how the game ended", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(endReason({ ...luddo({ matchMinutes: 5 }), matchEndsAt: "2026-10-01T11:59:00Z" }, now)).toBe("clock");
    expect(endReason(luddo({}, 2), now)).toBe("first_home");
    expect(endReason(luddo(), now)).toBe("all_placed");
  });

  it("counts a partner's win in Team Up", () => {
    const state = luddo({ teamUp: true });
    const red = state.players.find((p) => p.color === "red")!;
    const yellow = state.players.find((p) => p.color === "yellow")!;
    const green = state.players.find((p) => p.color === "green")!;
    const won = { ...state, winnerIds: [red.id] };
    expect(seatWon(won, yellow.id)).toBe(true);
    expect(seatWon(won, green.id)).toBe(false);
    expect(seatWon({ ...won, rules: DEFAULT_ROOM_RULES }, yellow.id)).toBe(false);
  });

  it("reports this seat's stats from the match results", () => {
    const state = { ...luddo(), status: "summary" as const, winnerIds: ["practice-1", "practice-0"] };
    const results: MatchResult[] = [
      {
        playerId: "practice-0",
        seatIndex: 0,
        color: state.players[0].color,
        isBot: false,
        placement: 2,
        stats: {
          rolls: 40,
          sixes: 7,
          faces: [6, 7, 6, 7, 7, 7],
          turns: 31,
          capturesMade: 3,
          pawnsLost: 2,
          pawnsFinished: 4,
          missedDecisions: 0,
          longestRunWithoutSix: 9,
        },
      },
    ];
    expect(resultParams(state, "practice-0", results)).toEqual({
      finish_place: 2,
      won: false,
      turn_count: 31,
      captures: 3,
      sixes: 7,
      pawns_home: 4,
      missed_decisions: 0,
      end_reason: "all_placed",
    });
  });
});

describe("room entry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts an untagged room link as an invite, or a party QR at a party table", () => {
    fakeBrowser();
    expect(roomEntry("r1", false)).toEqual({ entry_point: "invite_link", play_context: "private_room" });
    expect(roomEntry("r1", true)).toEqual({ entry_point: "party_qr", play_context: "party" });
  });

  it("remembers how this tab got to a room, and that a party room is a party", () => {
    fakeBrowser();
    tagRoomEntry("r2", { entry_point: "quick_match", play_context: "quick_match" });
    expect(roomEntry("r2", false)).toEqual({ entry_point: "quick_match", play_context: "quick_match" });
    tagRoomEntry("r3", { entry_point: "room_code", play_context: "private_room" });
    expect(roomEntry("r3", true)).toEqual({ entry_point: "room_code", play_context: "party" });
  });

  it("keeps the last 20 rooms", () => {
    const win = fakeBrowser();
    for (let i = 0; i < 25; i++) tagRoomEntry(`room-${i}`, { entry_point: "created", play_context: "private_room" });
    const stored = JSON.parse(win.sessionStorage.getItem("luddo-analytics-entry-v1")!);
    expect(Object.keys(stored)).toHaveLength(20);
    expect(stored["room-0"]).toBeUndefined();
  });
});
