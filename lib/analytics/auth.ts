import type { User } from "@supabase/supabase-js";
import type { SignInMethod } from "./events";
import { stopAnalyticsForChild } from "./children";
import { setUserProperties, track } from "./index";

/**
 * `sign_up` and `login` (docs/analytics.md, "Identity").
 *
 * The click that starts a sign-in notes the method and who was signed in
 * before, in sessionStorage (it survives the OAuth round trip in the same
 * tab). When an account then appears on any auth event:
 *
 * - the same user id that was a guest before → `sign_up` with `from_guest`:
 *   the guest was upgraded by linking and keeps its progress;
 * - a user created in the last 10 minutes → `sign_up`;
 * - anything else → `login`.
 *
 * Sessions restored on load, other tabs and token refreshes have no note, so
 * they send nothing. The event waits for the account's age answer, so an
 * under-13 account's sign-in is never reported.
 */

const PENDING_KEY = "luddo-analytics-signin-v1";
const PENDING_TTL_MS = 30 * 60 * 1000;
const NEW_ACCOUNT_MS = 10 * 60 * 1000;

interface PendingSignIn {
  method: SignInMethod;
  at: number;
  priorId: string | null;
  priorAnonymous: boolean;
}

export function noteSignInStarted(method: SignInMethod, prior: Pick<User, "id" | "is_anonymous"> | null) {
  try {
    const pending: PendingSignIn = {
      method,
      at: Date.now(),
      priorId: prior?.id ?? null,
      priorAnonymous: !!prior?.is_anonymous,
    };
    window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* Private mode: this sign-in goes unreported. */
  }
}

function takePending(): PendingSignIn | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PENDING_KEY);
    const pending = JSON.parse(raw) as PendingSignIn;
    return Date.now() - pending.at < PENDING_TTL_MS ? pending : null;
  } catch {
    return null;
  }
}

export interface SignInEligibility {
  declared: boolean;
  online: boolean;
  eligibleFrom: string | null;
}

/**
 * Called for every auth state change (and the initial session). With
 * `eligibility` (the server's age answer for this account), a sign-in is only
 * reported once the account is known not to be under 13: an under-13 account
 * turns analytics off instead, and a failed check reports nothing.
 */
export async function handleAuthUser(
  user: User | null,
  now = Date.now(),
  eligibility?: () => Promise<SignInEligibility>,
) {
  setUserProperties({ player_type: !user ? "visitor" : user.is_anonymous ? "guest" : "signed_in" });
  if (!user || user.is_anonymous) return;
  const pending = takePending();
  if (!pending) return;
  if (eligibility) {
    try {
      const age = await eligibility();
      if (age.declared && !age.online) {
        stopAnalyticsForChild(age.eligibleFrom);
        return;
      }
    } catch {
      return;
    }
  }
  const once = `sign_in:${user.id}:${pending.at}`;
  if (pending.priorId === user.id && pending.priorAnonymous) {
    track("sign_up", { method: pending.method, from_guest: true }, { once });
    return;
  }
  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  if (Number.isFinite(created) && now - created < NEW_ACCOUNT_MS)
    track("sign_up", { method: pending.method, from_guest: false }, { once });
  else track("login", { method: pending.method }, { once });
}
