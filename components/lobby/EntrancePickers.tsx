"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

// A segmented control (radio group) for the entrance setup screen, one row
// unless `maxColumns` asks for even rows. Every option stays visible and one
// tap away — no dropdowns, no sideways scrolling — which is what lets the
// whole table setup fit one phone screen.
// Arrow keys move the selection like a native radio group (roving tabindex).
export function Segmented<T extends string | number>({
  label,
  hideLabel = false,
  hint,
  options,
  value,
  onChange,
  maxColumns,
}: {
  label: string;
  /** Keep the label for screen readers only (e.g. a self-explanatory toggle). */
  hideLabel?: boolean;
  hint?: ReactNode;
  options: readonly { value: T; label: ReactNode; ariaLabel?: string }[];
  value: T;
  onChange: (value: T) => void;
  /**
   * The most options in a row; more wrap onto even rows (7 at 4 is 4 + 3),
   * for labels too long to share a phone-width row.
   */
  maxColumns?: number;
}) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const rows = Math.ceil(options.length / (maxColumns ?? options.length));
  const columns = Math.ceil(options.length / rows);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    // Visual order flips in right-to-left languages.
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    const dir = horizontal && rtl ? -step : step;
    const next = (selectedIndex + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }
  return (
    <div className="entrance-field">
      <span
        className={hideLabel ? "sr-only" : "entrance-field-label"}
        id={labelId}
      >
        {label}
      </span>
      <div
        className={`entrance-segmented${options.length >= 4 ? " is-dense" : ""}`}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {options.map((option, i) => (
          <button
            key={String(option.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            aria-label={option.ariaLabel}
            tabIndex={i === selectedIndex ? 0 : -1}
            className={option.value === value ? "is-selected" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint && <small className="entrance-field-hint">{hint}</small>}
    </div>
  );
}

// A bottom sheet on phones (a centered card on wider screens) built on the
// native <dialog>: showModal() gives focus trapping, inert page content and
// Escape-to-close for free. Tapping the dimmed backdrop also closes it.
export function EntranceSheet({
  open,
  title,
  doneLabel,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  doneLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="entrance-sheet"
      aria-label={title}
      // Escape: let the parent decide (it also unwinds the history entry).
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click whose target is the <dialog> itself landed on the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="entrance-sheet-body">
        <span className="entrance-sheet-grip" aria-hidden="true" />
        <h2>{title}</h2>
        {children}
        <button type="button" className="sim-primary" onClick={onClose}>
          <span>{doneLabel}</span>
        </button>
      </div>
    </dialog>
  );
}
