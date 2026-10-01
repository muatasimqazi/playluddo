"use client";

import { Icon } from "@/components/simulator/Icon";
import { useI18n } from "@/lib/i18n";
import type { Cast } from "@/lib/hooks/useCast";

/**
 * Whether to offer Cast to TV: only where this browser can present and a
 * display is actually there to pick (or is already showing the table), so the
 * button never appears where casting can't work, such as inside the app.
 */
export function canCast(cast: Cast | undefined): cast is Cast {
  return !!cast && cast.supported && (cast.available || cast.connected);
}

/** The button's label for where the cast is up to. */
export function useCastLabel(cast: Cast | undefined) {
  const { t } = useI18n();
  if (cast?.connected) return t("cast.stopCasting");
  if (cast?.connecting) return t("cast.casting");
  return t("cast.castToTv");
}

/** Starts the cast, or stops the one that's showing. */
export function toggleCast(cast: Cast) {
  if (cast.connected) cast.stop();
  else void cast.start();
}

/** Cast to TV, for the lobby and the Party controller. */
export function CastButton({ cast, className = "" }: { cast: Cast | undefined; className?: string }) {
  const { t } = useI18n();
  const label = useCastLabel(cast);
  if (!canCast(cast)) return null;
  return (
    <button
      type="button"
      className={`${className} ${cast.connected ? "is-casting" : ""}`}
      onClick={() => toggleCast(cast)}
      disabled={cast.connecting}
      title={t("cast.castTitle")}
    >
      <Icon name="cast" size={16} />
      {label}
    </button>
  );
}
