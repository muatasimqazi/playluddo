"use client";

/**
 * F5.1 Localization — language picker.
 *
 * A pill button (the header's .profile-trigger look) that opens our own
 * picker rather than the OS <select> sheet: a menu anchored under the pill
 * on wide screens, a bottom sheet on phones — the same pattern as the
 * entrance's avatar picker. It's a native <dialog> opened with showModal(),
 * so focus trapping, Escape, inert page content and returning focus to the
 * pill all come from the platform. Each language shows its endonym (how its
 * own speakers name it) with the English name beneath for everyone else.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { LOCALES, useI18n, type LocaleCode } from "@/lib/i18n";
import { persistLocalePreference } from "@/lib/preferences";
import { Icon } from "@/components/simulator/Icon";

const MENU_WIDTH = 248;
const EDGE = 12;

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const label = t("language.label");
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  // Where the wide-screen menu sits: just under the pill, its end edge lined
  // up with the pill's (right edge in LTR, left in RTL), kept on screen.
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });

  function show() {
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      const rtl = getComputedStyle(trigger.current!).direction === "rtl";
      const left = rtl ? rect.left : rect.right - MENU_WIDTH;
      setAnchor({
        top: rect.bottom + 8,
        left: Math.min(Math.max(left, EDGE), window.innerWidth - MENU_WIDTH - EDGE),
      });
    }
    dialog.current?.showModal();
    setOpen(true);
    // Land on the current language, like a native picker.
    const index = LOCALES.findIndex((l) => l.code === locale);
    requestAnimationFrame(() => options.current[Math.max(index, 0)]?.focus());
  }
  function hide() {
    dialog.current?.close();
  }
  function choose(code: LocaleCode) {
    setLocale(code);
    persistLocalePreference(code);
    hide();
  }
  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, (i: number) => number> = {
      ArrowDown: (i) => (i + 1) % LOCALES.length,
      ArrowUp: (i) => (i - 1 + LOCALES.length) % LOCALES.length,
      Home: () => 0,
      End: () => LOCALES.length - 1,
    };
    const move = keys[e.key];
    if (!move) return;
    e.preventDefault();
    const at = options.current.indexOf(document.activeElement as HTMLButtonElement);
    options.current[move(Math.max(at, 0))]?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`language-switcher${className ? ` ${className}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${current.nativeName}`}
        onClick={show}
      >
        <span className="language-switcher-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
          </svg>
        </span>
        <span className="language-switcher-label" lang={current.code}>
          {current.nativeName}
        </span>
        <svg
          className="language-switcher-chevron"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        className="language-menu"
        aria-label={label}
        style={{ "--menu-top": `${anchor.top}px`, "--menu-left": `${anchor.left}px` } as React.CSSProperties}
        onClose={() => setOpen(false)}
        // A click whose target is the <dialog> itself landed outside the panel.
        onClick={(e) => {
          if (e.target === e.currentTarget) hide();
        }}
      >
        <div className="language-menu-body">
          <span className="language-menu-grip" aria-hidden="true" />
          <h2>{label}</h2>
          <div role="listbox" aria-label={label} onKeyDown={onListKeyDown}>
            {LOCALES.map((l, i) => {
              const selected = l.code === locale;
              return (
                <button
                  key={l.code}
                  ref={(el) => {
                    options.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? "is-selected" : ""}
                  onClick={() => choose(l.code)}
                >
                  <span>
                    <strong lang={l.code} dir={l.dir}>
                      {l.nativeName}
                    </strong>
                    {l.englishName !== l.nativeName && <small>{l.englishName}</small>}
                  </span>
                  {selected && <Icon name="check" size={16} />}
                </button>
              );
            })}
          </div>
        </div>
      </dialog>
    </>
  );
}
