import { presetOf } from "../board/presets";
import { resolveRoomRules, teamColors } from "../board/rules";
import type { GameRoomState, MatchResult } from "../board/types";
import type {
  AnalyticsGameType,
  GameCompletedParams,
  GameMode,
  GameParams,
  PlayContext,
} from "./events";

/** The game's analytics name: always "Luddo", never the engine's "ludo". */
export function analyticsGameType(gameType: string): AnalyticsGameType {
  return gameType === "snakes_and_ladders" ? "snakes_ladders" : "luddo";
}

/**
 * One headline mode per game: Team Up and Rush stack on top of a preset, so
 * they win; otherwise the preset the rules match, or `custom`. Classic with a
 * 30-second timer is the Family preset by definition (lib/board/presets.ts).
 */
export function gameModeOf(state: Pick<GameRoomState, "gameType" | "rules">): {
  game_mode: GameMode;
  rules_customized: boolean;
} {
  const rules = resolveRoomRules(state.rules);
  if (state.gameType === "snakes_and_ladders") {
    const customized = rules.snakesAnyRollToStart || rules.snakesBounceBack;
    return { game_mode: customized ? "custom" : "classic", rules_customized: customized };
  }
  const preset = presetOf(rules);
  const customized = preset === null;
  if (rules.teamUp) return { game_mode: "team_up", rules_customized: customized };
  if (rules.matchMinutes > 0) return { game_mode: "rush", rules_customized: customized };
  return { game_mode: preset ?? "custom", rules_customized: customized };
}

export function gameParamsFromState(
  state: GameRoomState,
  context: { game_id: string; play_context: PlayContext; bot_difficulty?: GameParams["bot_difficulty"] },
): GameParams {
  const rules = resolveRoomRules(state.rules);
  const bots = state.players.filter((p) => p.isBot).length;
  return {
    game_id: context.game_id,
    game_type: analyticsGameType(state.gameType),
    ...gameModeOf(state),
    play_context: context.play_context,
    seat_count: state.players.length,
    human_count: state.players.length - bots,
    bot_count: bots,
    bot_difficulty: context.bot_difficulty,
    turn_timer_s: state.isParty && state.partyTurnSeconds ? state.partyTurnSeconds : rules.turnSeconds,
  };
}

/** Did this seat's side win? In Team Up, a partner's first place counts. */
export function seatWon(state: GameRoomState, playerId: string): boolean {
  const winner = state.players.find((p) => p.id === state.winnerIds[0]);
  const me = state.players.find((p) => p.id === playerId);
  if (!winner || !me) return false;
  if (state.gameType === "ludo" && resolveRoomRules(state.rules).teamUp)
    return teamColors(winner.color, true).has(me.color);
  return winner.id === me.id;
}

export function endReason(state: GameRoomState, now = Date.now()): GameCompletedParams["end_reason"] {
  const rules = resolveRoomRules(state.rules);
  if (rules.matchMinutes > 0 && state.matchEndsAt && Date.parse(state.matchEndsAt) <= now) return "clock";
  if (state.gameType === "ludo" && state.players.length === 2) return "first_home";
  return "all_placed";
}

/** This seat's own results and stats from get_match_results, as completion parameters. */
export function resultParams(
  state: GameRoomState,
  playerId: string,
  results: MatchResult[] | null,
): Partial<GameCompletedParams> {
  const mine = results?.find((r) => r.playerId === playerId);
  const place = mine?.placement ?? (state.winnerIds.indexOf(playerId) + 1 || undefined);
  return {
    finish_place: place,
    won: seatWon(state, playerId),
    turn_count: mine?.stats.turns,
    captures: mine?.stats.capturesMade,
    sixes: mine?.stats.sixes,
    pawns_home: mine?.stats.pawnsFinished,
    missed_decisions: mine?.stats.missedDecisions,
    end_reason: endReason(state),
  };
}
