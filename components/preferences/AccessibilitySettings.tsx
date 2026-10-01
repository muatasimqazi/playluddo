"use client";

/**
 * The Accessibility section of the profile panel (F5.5): colour-blind mode
 * and reduce motion. Saved like board style, to the account when signed in
 * and to this device for guests, so they follow the player to every table,
 * Party phone and replay. The table's own Preferences panel has the same two
 * switches.
 */
import { useI18n } from "@/lib/i18n";
import { useGamePreference } from "@/lib/preferences-react";
import { useReducedMotion } from "@/lib/hooks/useReducedMotion";

export function AccessibilitySettings() {
  const { t } = useI18n();
  const [colorBlind, setColorBlind] = useGamePreference("colorBlind");
  const [reduceMotion, setReduceMotion] = useGamePreference("reduceMotion");
  const reducedMotion = useReducedMotion();
  return (
    <section className="profile-teams notification-settings" aria-labelledby="accessibility-heading">
      <div className="profile-team-heading">
        <div>
          <h3 id="accessibility-heading">{t("accessibility.heading")}</h3>
        </div>
      </div>
      <div className="notification-kinds">
        <label className="profile-privacy">
          <input
            type="checkbox"
            checked={colorBlind}
            onChange={(e) => setColorBlind(e.target.checked)}
          />
          <span>
            <strong>{t("accessibility.colorBlind")}</strong>
            <small>{t("accessibility.colorBlindHint")}</small>
          </span>
        </label>
        <label className="profile-privacy">
          <input
            type="checkbox"
            checked={reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
          />
          <span>
            <strong>{t("accessibility.reduceMotion")}</strong>
            <small>
              {reducedMotion && !reduceMotion
                ? t("accessibility.reduceMotionSystem")
                : t("accessibility.reduceMotionHint")}
            </small>
          </span>
        </label>
      </div>
    </section>
  );
}
