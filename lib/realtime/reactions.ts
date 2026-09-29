/**
 * Everything a player can send as a reaction (docs/COMPETITIVE_ROADMAP.md
 * F1.3). The server accepts exactly this list: private.allowed_reactions()
 * in supabase/migrations/20260928080000_more_reactions.sql, checked against
 * this file by tests/parity. Only ever add to it: older app versions still
 * send the first six emoji.
 */

/** Four themed rows of six. */
export const REACTION_EMOJI_ROWS: readonly (readonly string[])[] = [
  ["👋", "👏", "😅", "🔥", "💛", "😂"],
  ["🎲", "🍀", "🎯", "🏆", "👑", "⭐"],
  ["😮", "😬", "😱", "🙈", "😎", "🤞"],
  ["🙌", "💪", "🤝", "🎉", "🤔", "😴"],
];

export const REACTION_PHRASES: readonly string[] = [
  "Nice move!",
  "So close!",
  "Lucky roll!",
  "Well played",
  "Good luck",
  "Oops!",
  "Hurry up 😅",
  "Your turn",
  "Thanks!",
  "Good game",
  "One more game?",
  "Revenge!",
];

/** Offered only right after one of your pieces was captured. */
export const REVENGE = "Revenge!";

export const ALL_REACTIONS: readonly string[] = [...REACTION_EMOJI_ROWS.flat(), ...REACTION_PHRASES];

/** Phrases get a speech bubble; emoji float on their own. */
export function isPhrase(text: string) {
  return REACTION_PHRASES.includes(text);
}
