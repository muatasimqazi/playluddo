/**
 * The table rules players agree to once, before their first online table
 * (App Store guideline 1.2: users agree to terms with no tolerance for
 * objectionable content). Remembered per device; bump the version when the
 * rules change so everyone sees them again.
 */
const RULES_KEY = "luddo-table-rules-v1";

export function tableRulesAccepted() {
  try {
    return localStorage.getItem(RULES_KEY) !== null;
  } catch {
    return false;
  }
}

export function acceptTableRules() {
  try {
    localStorage.setItem(RULES_KEY, new Date().toISOString());
  } catch {
    // Private mode: they'll see the rules again next time.
  }
}

/**
 * After an under-13 answer, this device stops taking new age answers until
 * the player turns 13 (docs/COMPETITIVE_ROADMAP.md decision 12), so a fresh
 * guest session can't simply try again. It holds only the day the block
 * lifts, and never stops an account that has already answered: the server
 * only asks accounts that haven't. Support can tell a parent how to clear it.
 */
const UNDER_13_KEY = "luddo-under-13-until";

export function deviceAgeBlocked() {
  try {
    const until = localStorage.getItem(UNDER_13_KEY);
    if (!until) return false;
    if (new Date(`${until}T00:00:00`) <= new Date()) {
      localStorage.removeItem(UNDER_13_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function blockDeviceUntil(eligibleFrom: string) {
  try {
    localStorage.setItem(UNDER_13_KEY, eligibleFrom);
  } catch {
    // Private mode: the server still refuses this account.
  }
}

// P7 / decision 7: short acceptance never grants chat or voice acceptance.
const PARTY_RULES_KEY = "luddo-party-rules-v1";
export function partyRulesAccepted() {
  try { return localStorage.getItem(PARTY_RULES_KEY) !== null; }
  catch { return false; }
}
export function acceptPartyRules() {
  try { localStorage.setItem(PARTY_RULES_KEY, new Date().toISOString()); }
  catch { /* Private mode: ask again next visit. */ }
}
