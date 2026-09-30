"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useI18n, type MessageKey } from "@/lib/i18n";
import {
  equipCosmetic,
  getMyCosmetics,
  type Cosmetic,
  type CosmeticType,
} from "@/lib/supabase/cosmetics";

const TYPE_ORDER: CosmeticType[] = ["board", "piece", "dice", "room", "reaction"];
const TYPE_KEYS: Record<CosmeticType, MessageKey> = {
  board: "profile.typeBoard",
  piece: "profile.typePiece",
  dice: "profile.typeDice",
  room: "profile.typeRoom",
  reaction: "profile.typeReaction",
};

/**
 * The player's own cosmetics locker (docs/COMPETITIVE_ROADMAP.md F3.5):
 * everything they've earned, grouped by type, with one equipped per type.
 * Only shown to the player themselves (the /profile page is self-only).
 */
export function CosmeticsLocker() {
  const { t } = useI18n();
  const client = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Cosmetic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const data = await getMyCosmetics(client);
        if (!cancelled) setItems(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : t("profile.cosmeticsLoadError"));
      }
    }
    void load();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profile.equipError"));
    } finally {
      setPending(null);
    }
  }

  if (error && !items) {
    return (
      <section className="cosmetics-locker">
        <p className="leaderboard-message is-error" role="alert">
          {error}
        </p>
      </section>
    );
  }
  if (!items) {
    return (
      <section className="cosmetics-locker">
        <div className="leaderboard-loading" aria-label={t("profile.cosmeticsLoading")}>
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      </section>
    );
  }

  const ownedCount = items.filter((c) => c.owned).length;

  return (
    <section className="cosmetics-locker">
      <span className="eyebrow">
        {t("profile.yourLocker", { owned: ownedCount, total: items.length }).toUpperCase()}
      </span>
      <p className="cosmetics-note">{t("profile.lockerNote")}</p>
      {error && (
        <p className="leaderboard-message is-error" role="alert">
          {error}
        </p>
      )}
      {TYPE_ORDER.map((type) => {
        const group = items.filter((c) => c.type === type);
        if (group.length === 0) return null;
        return (
          <div key={type} className="cosmetics-group">
            <h3>{t(TYPE_KEYS[type])}</h3>
            <ul>
              {group.map((c) => (
                <li key={c.id} className={c.owned ? "is-owned" : "is-locked"}>
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.owned ? c.description : c.requirement ?? c.description}</small>
                  </span>
                  {c.equipped ? (
                    <span className="cosmetics-equipped">{t("profile.equipped")}</span>
                  ) : c.owned ? (
                    <button
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void equip(c)}
                    >
                      {pending === c.id ? "…" : t("profile.equip")}
                    </button>
                  ) : (
                    <span className="cosmetics-lock" aria-hidden="true">
                      🔒
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
