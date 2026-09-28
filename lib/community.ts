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
