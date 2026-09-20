"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchMe, signOut, type AuthUser } from "@/lib/auth";
import { TABS } from "./tabs";

/**
 * Shell shared by every dashboard tab: the session check, the identity strip
 * and the tab bar.
 *
 * The tabs are routes rather than local state, so each one is a separate
 * component that mounts and fetches on its own. It also means a tab can be
 * linked to and reloaded directly, and the browser's back button moves
 * between them the way people expect.
 *
 * Verifying the session here rather than in each page means one check for the
 * whole section — a tab added later is protected by existing.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      if (!me) {
        router.replace(`/signin?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setUser(me);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
    // Re-running on every navigation would re-check the session on each tab
    // change for no benefit; the layout persists across them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function onSignOut() {
    await signOut().catch(() => undefined);
    router.replace("/signin");
    router.refresh();
  }

  if (checking) {
    return (
      <div className="surface-light">
        <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
          <p className="text-sm text-[var(--color-ink-muted)]">Checking your session…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="surface-light min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-7">
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <Link href="/" className="font-serif text-2xl tracking-tight transition hover:opacity-70">
              IncidentOS
            </Link>
            <span className="text-xs text-[var(--color-ink-muted)]">Investigate. Fix. Verify.</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {user && <span className="text-[var(--color-ink-muted)]">{user.name}</span>}
            <button
              type="button"
              onClick={onSignOut}
              className="rounded border border-[var(--color-ink-muted)]/30 px-2 py-1 text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
            >
              Sign out
            </button>
          </div>
        </header>

        <nav className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-inset)] p-1" aria-label="Dashboard sections">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg border px-4 py-3 text-center text-[13.5px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-clay-deep)] ${
                  active
                    ? "border-[var(--color-clay)]/40 bg-[var(--color-tab-active)] text-[var(--color-clay-deep)] shadow-sm"
                    : "border-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </div>
  );
}
