"use client";

import { useId, useState } from "react";

/**
 * A labelled input that reports its own error.
 *
 * The error is wired through `aria-describedby` and `aria-invalid` rather than
 * being colour-only, so it reaches a screen reader and survives a
 * forced-colours theme.
 */
export function Field({
  label,
  type = "text",
  value,
  onChange,
  onBlur,
  error,
  autoComplete,
  placeholder,
  hint,
  revealable = false,
  autoFocus = false,
}: {
  label: string;
  type?: "text" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: React.ReactNode;
  revealable?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const [revealed, setRevealed] = useState(false);

  const inputType = revealable && revealed ? "text" : type;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13.5px] font-medium">
          {label}
        </label>
        {revealable && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="text-[12.5px] text-[var(--color-ink-dark-secondary)] underline-offset-2 transition hover:text-[var(--color-ink-dark)] hover:underline"
          >
            {revealed ? "Hide" : "Show"}
          </button>
        )}
      </div>

      <input
        id={id}
        type={inputType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="mt-1.5 w-full rounded-md border bg-[var(--color-card)] px-3 py-2.5 text-[14.5px] outline-none transition placeholder:text-[var(--color-ink-dark-muted)] focus:ring-2"
        style={{
          borderColor: error ? "var(--color-status-critical)" : "var(--color-rule-strong)",
          // @ts-expect-error -- custom property for the focus ring colour
          "--tw-ring-color": error
            ? "color-mix(in srgb, var(--color-status-critical) 22%, transparent)"
            : "color-mix(in srgb, var(--color-ink-dark) 14%, transparent)",
        }}
      />

      {/*
        The message slot is always in the layout, whether or not there is a
        message in it. An error that appears and pushes the rest of the form
        down will move a link out from under a click that is already in
        flight — reserving the line costs nothing and removes the whole class
        of bug.
      */}
      <div className="mt-1.5 flex min-h-5 items-center" aria-live="polite">
        {error ? (
          // leading-5 matches the slot's min-height exactly, so a single-line
          // error occupies the space already reserved for it and nothing moves.
          <p
            id={errorId}
            className="text-[12.5px] leading-5"
            style={{ color: "var(--color-status-critical)" }}
          >
            {error}
          </p>
        ) : (
          hint
        )}
      </div>
    </div>
  );
}
