import type { Player } from "../board/types";
import type { PartyExtras, PartyMoment } from "../supabase/rpc";

/**
 * Words for Party Mode's audience features (docs/COMPETITIVE_ROADMAP.md
 * Section 6, P6): the moments of a match and the lobby's picks.
 */

function nameOf(players: readonly Pick<Player, "id" | "displayName">[], id: string) {
  return players.find((p) => p.id === id)?.displayName ?? "Someone";
}

function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "Theo captured Nia's piece", "Nia climbed a ladder from 28 to 54". */
export function describeMoment(moment: PartyMoment, players: readonly Pick<Player, "id" | "displayName">[]) {
  const who = nameOf(players, moment.playerId);
  switch (moment.kind) {
    case "capture": {
      const victims = moment.capturedPlayerIds.map((id) => nameOf(players, id));
      if (victims.length === 0) return `${who} captured a piece`;
      if (victims.length === 1) return `${who} captured ${victims[0]}'s piece`;
      return `${who} captured pieces from ${victims.join(" and ")}`;
    }
    case "finished":
      return moment.place === 1 ? `${who} won` : `${who} finished ${ordinal(moment.place ?? 0)}`;
    case "ladder":
      return `${who} climbed a ladder from ${moment.from} to ${moment.to}`;
    case "snake":
      return `${who} slid down a snake from ${moment.from} to ${moment.to}`;
  }
}

/** The moment with the most votes (the later one on a tie), or null before any. */
export function topMoment(extras: Pick<PartyExtras, "moments" | "votes">): { moment: PartyMoment; votes: number } | null {
  let best: { moment: PartyMoment; votes: number } | null = null;
  for (const moment of extras.moments) {
    const votes = extras.votes.find((v) => v.sequence === moment.sequence)?.count ?? 0;
    if (votes > 0 && (!best || votes >= best.votes)) best = { moment, votes };
  }
  return best;
}

/** The lobby's picks for a player. */
export function picksFor(extras: Pick<PartyExtras, "predictions">, playerId: string) {
  return extras.predictions.find((p) => p.playerId === playerId)?.count ?? 0;
}
