"use client";

/**
 * The Dice & pieces section of the profile panel (F3.5): every dice skin and
 * piece style, the earned ones choosable and the rest shown with how to earn
 * them. Equipping saves to the account, so the choice follows the player to
 * every table, where everyone sees it. The table's own Dice & pieces panel
 * offers the same choice mid-game.
 */
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { equipCosmetic, getMyCosmetics, type Cosmetic } from "@/lib/supabase/cosmetics";
import { useI18n } from "@/lib/i18n";

const GROUPS = [
  ["dice", "profile.typeDice"],
  ["piece", "profile.typePiece"],
] as const;

export function LoadoutSettings() {
  const { t } = useI18n();
  const client = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Cosmetic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getMyCosmetics(client);
        if (!cancelled) setItems(data.filter((c) => c.type === "dice" || c.type === "piece"));
      } catch {
        if (!cancelled) setError(t("profile.cosmeticsLoadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `t` only feeds the catch fallback; excluding it avoids a locale-change reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  async function equip(cosmetic: Cosmetic) {
    setPending(cosmetic.id);
    setError(null);
    try {
      await equipCosmetic(client, cosmetic.id);
      setItems((prev) =>
        prev
          ? prev.map((c) =>
              c.type === cosmetic.type ? { ...c, equipped: c.id === cosmetic.id } : c,
            )
          : prev,
      );
    } catch {
      setError(t("profile.equipError"));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="profile-teams notification-settings" aria-labelledby="loadout-heading">
      <div className="profile-team-heading">
        <div>
          <h3 id="loadout-heading">{t("loadout.heading")}</h3>
        </div>
      </div>
      <p className="notification-note">{t("loadout.note")}</p>
      {error && (
        <p className="notification-note" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && (
        <p className="notification-note" aria-busy="true">
          {t("profile.cosmeticsLoading")}…
        </p>
      )}
      {items &&
        GROUPS.map(([type, labelKey]) => {
          const group = items.filter((c) => c.type === type);
          if (group.length === 0) return null;
          return (
            <fieldset key={type} className="notification-kinds loadout-group">
              <legend>{t(labelKey)}</legend>
              {group.map((c) => (
                <label key={c.id} className={`profile-privacy ${c.owned ? "" : "is-locked"}`}>
                  <input
                    type="radio"
                    name={`loadout-${type}`}
                    checked={c.equipped}
                    disabled={!c.owned || pending !== null}
                    onChange={() => void equip(c)}
                  />
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {c.owned
                        ? c.description
                        : t("loadout.locked", { requirement: c.requirement ?? "" })}
                    </small>
                  </span>
                </label>
              ))}
              {type === "piece" && !group.some((c) => c.equipped) && (
                <small className="notification-on-here">{t("loadout.boardPieces")}</small>
              )}
            </fieldset>
          );
        })}
    </section>
  );
}
