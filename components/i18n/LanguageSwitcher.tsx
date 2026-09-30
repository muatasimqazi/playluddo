"use client";

/**
 * F5.1 Localization — language picker.
 *
 * A native <select> on purpose: it's fully keyboard- and screen-reader
 * accessible for free, opens as the platform's own control on iOS/Android
 * (Capacitor) and on TV browsers, and needs no popover/focus-trap code. Each
 * option shows the language's endonym (how its own speakers name it).
 */
import { useId } from "react";
import { LOCALES, useI18n, type LocaleCode } from "@/lib/i18n";
import { persistLocalePreference } from "@/lib/preferences";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const id = useId();
  const label = t("language.label");

  return (
    <label className={`language-switcher${className ? ` ${className}` : ""}`} htmlFor={id}>
      <span className="language-switcher-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
        </svg>
      </span>
      <span className="sr-only">{label}</span>
      <select
        id={id}
        aria-label={label}
        value={locale}
        onChange={(e) => {
          const next = e.target.value as LocaleCode;
          setLocale(next);
          persistLocalePreference(next);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}
