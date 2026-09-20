"use client";

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--color-ink-dark)] px-4 py-2.5 text-[14px] font-medium text-[var(--color-canvas)] transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

/** Inline status or error message shown above a form. */
export function Notice({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="status"
      className="rounded-md border px-3 py-2.5 text-[13px]"
      style={{
        borderColor: "color-mix(in srgb, var(--color-clay) 35%, transparent)",
        background: "color-mix(in srgb, var(--color-clay) 8%, transparent)",
        color: "var(--color-clay-deep)",
      }}
    >
      {children}
    </div>
  );
}
