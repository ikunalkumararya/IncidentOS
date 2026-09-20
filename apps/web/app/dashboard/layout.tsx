"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchMe, signOut, type AuthUser } from "@/lib/auth";
import { TABS } from "./tabs";
import { ProfileMenu } from "@/components/ProfileMenu";

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
        <main className="flex min-h-screen w-full items-center justify-center px-5">
          <p className="text-sm text-[var(--color-ink-muted)]">Checking your session…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="surface-light min-h-screen">
      <div className="w-full px-5 py-5 sm:py-7">
        <header className="mb-7 flex items-center justify-between gap-4 border-b border-[var(--color-hairline)] pb-5">
          <Link href="/dashboard/incident-analysis" className="group flex shrink-0 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-clay-deep)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-ink)] text-[var(--color-surface)] transition group-hover:bg-[var(--color-clay-deep)]" aria-hidden="true">
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h4l3-7 4 14 3-7h4" />
              </svg>
            </span>
            <div>
              <span className="block font-serif text-[25px] leading-none tracking-tight">IncidentOS</span>
              <span className="mt-1.5 hidden text-[11px] tracking-wide text-[var(--color-ink-muted)] sm:block">Investigate. Fix. Verify.</span>
            </div>
          </Link>
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            {user && <ProfileMenu user={user} />}
            <button
              type="button"
              onClick={onSignOut}
              className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-ink-secondary)] transition hover:border-[var(--color-baseline)] hover:bg-[var(--color-inset)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-clay-deep)]"
            >
              Sign out
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5H5v14h4M10 12h11m-4-4 4 4-4 4" />
              </svg>
            </button>
          </div>
        </header>

        <nav className="mb-7 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-inset)] p-1.5" aria-label="Dashboard sections">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-w-0 items-center justify-center gap-2.5 rounded-xl border px-2 py-3.5 text-center text-xs font-medium transition sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-clay-deep)] ${
                  active
                    ? "border-[var(--color-clay)]/30 bg-[var(--color-surface)] text-[var(--color-clay-deep)] shadow-[0_2px_5px_rgba(41,39,32,0.06)]"
                    : "border-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                }`}
              >
                <svg aria-hidden="true" className="shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  {tab.icon === "incident" ? (
                    <><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M6 12h3l2-4 3 8 2-4h2" /></>
                  ) : (
                    <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>
                  )}
                </svg>
                {tab.label}
                {active && <span aria-hidden="true" className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-[var(--color-clay)] sm:inset-x-16" />}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </div>
  );
}
