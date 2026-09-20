"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "@/lib/auth";

export function ProfileMenu({ user }: { user: AuthUser }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const joined = new Date(user.createdAt);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={`View profile for ${user.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="profile-dialog"
        onClick={() => { dialog.current?.showModal(); setOpen(true); }}
        className="flex min-h-11 min-w-11 items-center justify-center gap-2.5 rounded-full p-1 transition hover:bg-[var(--color-inset)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-clay-deep)] sm:rounded-xl sm:pr-3"
      >
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-inset)] text-xs font-semibold text-[var(--color-ink-secondary)]">{initials}</span>
        <span className="hidden max-w-40 truncate text-sm text-[var(--color-ink-secondary)] sm:block">{user.name}</span>
        <svg aria-hidden="true" className="hidden text-[var(--color-ink-muted)] sm:block" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m7 10 5 5 5-5" /></svg>
      </button>

      <dialog
        ref={dialog}
        id="profile-dialog"
        aria-labelledby="profile-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
        }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-0 text-[var(--color-ink)] shadow-2xl backdrop:bg-black/35 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-6 py-4">
          <h2 id="profile-title" className="text-2xl">Your profile</h2>
          <button type="button" autoFocus aria-label="Close profile" onClick={() => dialog.current?.close()} className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-inset)] focus-visible:outline-2 focus-visible:outline-[var(--color-clay-deep)]">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>
        <div className="p-6">
          <div className="mb-6 flex items-center gap-4">
            <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--color-tab-active)] font-serif text-2xl text-[var(--color-clay-deep)]">{initials}</span>
            <div className="min-w-0">
              <p className="break-words text-lg font-medium">{user.name}</p>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">IncidentOS account</p>
            </div>
          </div>
          <dl className="space-y-5">
            {[
              ["Full name", user.name],
              ["Email address", user.email],
              ["Member since", Number.isNaN(joined.getTime()) ? "Unavailable" : joined.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</dt>
                <dd className="mt-1.5 break-words text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <form method="dialog" className="border-t border-[var(--color-hairline)] px-6 py-4 text-right">
          <button className="min-h-10 rounded-lg bg-[var(--color-ink)] px-5 text-sm font-medium text-[var(--color-surface)] hover:bg-[var(--color-clay-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-clay-deep)]">Done</button>
        </form>
      </dialog>
    </>
  );
}
