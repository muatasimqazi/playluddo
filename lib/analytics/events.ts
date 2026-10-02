/**
 * The analytics event catalog (docs/analytics.md). Every event the app sends,
 * to Google Analytics (website, through Google Tag Manager) and PostHog
 * (website and app), is named here with its parameter types, so a misspelt
 * event or a wrong parameter fails type-checking.
 *
 * Values are codes, never translated text, and never anything that names a
 * person, grants access to a table (room ids, room codes, invite or cast
 * tokens) or reveals an age. See lib/analytics/sanitize.ts and redact.ts.
 */

export type AnalyticsGameType = "luddo" | "snakes_ladders";
export type GameMode = "classic" | "quick" | "master" | "family" | "rush" | "team_up" | "custom";
export type PlayContext =
  | "practice"
  | "table_together"
  | "private_room"
  | "quick_match"
  | "party"
  | "tournament"
  | "team";
export type EntryPoint =
  | "created"
  | "invite_link"
  | "room_code"
  | "play_again"
  | "rematch"
  | "quick_match"
  | "tournament"
  | "team"
  | "party_qr"
  | "offline";
export type PlayMode = "quick_match" | "private_room" | "practice" | "table_together" | "party";
export type SignInMethod = "google" | "apple" | "email_code" | "phone_code" | "game_center";
export type GamePhase = "lobby" | "in_game" | "summary";
export type ErrorArea =
  | "room_access"
  | "join"
  | "create"
  | "matchmaking"
  | "start"
  | "rematch"
  | "reclaim"
  | "three_d";

/** Shared by the game lifecycle events (docs/analytics.md, "Shared game parameters"). */
export interface GameParams {
  /** The match UUID online (grants nothing); a random id made at game start offline. */
  game_id: string;
  game_type: AnalyticsGameType;
  game_mode: GameMode;
  play_context: PlayContext;
  seat_count: number;
  human_count: number;
  bot_count: number;
  bot_difficulty?: "easy" | "normal" | "hard";
  rules_customized: boolean;
  turn_timer_s?: number;
}

export interface GameCompletedParams extends GameParams {
  duration_seconds?: number;
  turn_count?: number;
  finish_place?: number;
  won?: boolean;
  captures?: number;
  sixes?: number;
  pawns_home?: number;
  missed_decisions?: number;
  seat_taken_over?: boolean;
  used_chat?: boolean;
  used_call?: boolean;
  reaction_count?: number;
  end_reason?: "all_placed" | "first_home" | "clock";
}

export interface PartyGameParams {
  game_id: string;
  game_type: AnalyticsGameType;
  game_mode: GameMode;
  human_count: number;
  bot_count: number;
  remote_count: number;
  audience_count?: number;
  duration_seconds?: number;
}

export type ShareContent =
  | "room_invite"
  | "room_code"
  | "watch_link"
  | "team_invite"
  | "highlight_clip"
  | "friend_code";

export interface EventMap {
  page_view: { page_location: string; page_referrer?: string; page_title?: string };

  // Getting to a table
  play_mode_selected: { play_mode: PlayMode };
  room_created: { game_type: AnalyticsGameType; seat_count: number; play_context: "private_room" | "team" };
  share: { method: "share_sheet" | "copy" | "download"; content_type: ShareContent };
  room_joined: {
    play_context: PlayContext;
    entry_point: EntryPoint;
    role: "host" | "player" | "audience";
    game_type: AnalyticsGameType;
  };
  matchmaking_started: { game_type: AnalyticsGameType; seat_count: number };
  match_found: {
    game_type: AnalyticsGameType;
    seat_count: number;
    human_count: number;
    bot_count: number;
    wait_seconds?: number;
  };
  matchmaking_cancelled: { wait_seconds?: number };
  play_again_used: { is_friend: boolean };
  watch_started: Record<string, never>;
  age_check_completed: { context: "online_table" | "sign_in" | "party" };
  age_check_dismissed: { context: "online_table" | "sign_in" | "party" };
  sign_up: { method: SignInMethod; from_guest: boolean };
  login: { method: SignInMethod };

  // Game lifecycle
  game_started: GameParams & { entry_point: EntryPoint; is_host: boolean; lobby_wait_seconds?: number };
  game_completed: GameCompletedParams;
  game_abandoned: GameParams & {
    abandon_reason: "left_table" | "match_abandoned" | "restarted";
    duration_seconds?: number;
  };
  rematch_requested: { role: "proposer" | "accepter" };

  // Party Mode (TV unless noted)
  party_screen_opened: { has_room: boolean };
  party_room_created: { game_type: AnalyticsGameType };
  party_game_started: PartyGameParams;
  party_game_completed: PartyGameParams;
  party_game_abandoned: PartyGameParams;
  party_table_paused: Record<string, never>;
  party_pause_ended: { outcome: "reconnected" | "carried_on" | "computer_took_over" };
  /** Sent by a phone. */
  party_controller_joined: { role: "vip" | "player" | "audience"; remote: boolean };
  cast_started: { is_party: boolean };

  // Seats and reliability
  seat_taken_over: { reason: "timeouts" | "disconnect"; play_context: PlayContext };
  seat_reclaimed: { play_context: PlayContext };
  realtime_reconnected: { offline_seconds: number; game_phase: GamePhase };
  realtime_reconnect_failed: { game_phase: GamePhase };
  app_error: { area: ErrorArea; error_code: string };

  // Social, progression and trust
  call_joined: Record<string, never>;
  friend_request_sent: { method: "code" | "recent_table" | "seat" };
  friend_request_accepted: Record<string, never>;
  level_up: { level: number };
  dice_check_run: { result: "verified" | "mismatch"; reason?: string };
  join_group: { group_type: "team" };
  tournament_created: { size: number; game_type: AnalyticsGameType };
  tournament_joined: Record<string, never>;
}

export type EventName = keyof EventMap;

/**
 * Every event name, in one list. The GTM trigger's regex is generated from it
 * (scripts/generate-gtm-container.ts) and a test keeps it equal to EventMap.
 */
export const EVENT_NAMES = [
  "page_view",
  "play_mode_selected",
  "room_created",
  "share",
  "room_joined",
  "matchmaking_started",
  "match_found",
  "matchmaking_cancelled",
  "play_again_used",
  "watch_started",
  "age_check_completed",
  "age_check_dismissed",
  "sign_up",
  "login",
  "game_started",
  "game_completed",
  "game_abandoned",
  "rematch_requested",
  "party_screen_opened",
  "party_room_created",
  "party_game_started",
  "party_game_completed",
  "party_game_abandoned",
  "party_table_paused",
  "party_pause_ended",
  "party_controller_joined",
  "cast_started",
  "seat_taken_over",
  "seat_reclaimed",
  "realtime_reconnected",
  "realtime_reconnect_failed",
  "app_error",
  "call_joined",
  "friend_request_sent",
  "friend_request_accepted",
  "level_up",
  "dice_check_run",
  "join_group",
  "tournament_created",
  "tournament_joined",
] as const satisfies readonly EventName[];

// Compile-time check that EVENT_NAMES lists every EventMap key.
type MissingFromList = Exclude<EventName, (typeof EVENT_NAMES)[number]>;
const everyEventListed: MissingFromList extends never ? true : MissingFromList = true;
void everyEventListed;

/** User properties: low-cardinality, set on change, never an age or game state. */
export interface UserProperties {
  player_type?: "visitor" | "guest" | "signed_in";
  app_locale?: string;
  colorblind_mode?: boolean;
  reduced_motion?: boolean;
  graphics_quality?: "low" | "medium" | "high" | "ultra";
  level_bucket?: "1" | "2-4" | "5-9" | "10-19" | "20+";
}

/** Every parameter any event or user property can carry (drives the GTM variables). */
export const PARAMETER_NAMES = [
  "page_location",
  "page_referrer",
  "page_title",
  "play_mode",
  "game_id",
  "game_type",
  "game_mode",
  "play_context",
  "seat_count",
  "human_count",
  "bot_count",
  "bot_difficulty",
  "rules_customized",
  "turn_timer_s",
  "entry_point",
  "is_host",
  "lobby_wait_seconds",
  "duration_seconds",
  "turn_count",
  "finish_place",
  "won",
  "captures",
  "sixes",
  "pawns_home",
  "missed_decisions",
  "seat_taken_over",
  "used_chat",
  "used_call",
  "reaction_count",
  "end_reason",
  "abandon_reason",
  "role",
  "method",
  "content_type",
  "wait_seconds",
  "is_friend",
  "context",
  "from_guest",
  "remote_count",
  "audience_count",
  "outcome",
  "remote",
  "is_party",
  "has_room",
  "reason",
  "offline_seconds",
  "game_phase",
  "area",
  "error_code",
  "level",
  "result",
  "group_type",
  "size",
  "debug_mode",
] as const;

export const USER_PROPERTY_NAMES = [
  "player_type",
  "app_locale",
  "colorblind_mode",
  "reduced_motion",
  "graphics_quality",
  "level_bucket",
] as const satisfies readonly (keyof UserProperties)[];
