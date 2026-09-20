"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IncidentChart } from "@/components/IncidentChart";
import { ActivityFeed, Diff, Hypotheses, Panel, Report, Verification } from "@/components/panels";
import { fetchMe, signOut, type AuthUser } from "@/lib/auth";
import type { Incident, TimelineMarker, TimelinePoint } from "@/lib/types";
import { API_BASE, useInvestigation } from "@/lib/useInvestigation";

const PHASES = [
  { key: "investigate", label: "Context" },
  { key: "hypothesize", label: "Hypotheses" },
  { key: "prove", label: "Evidence" },
  { key: "fix", label: "Fix" },
  { key: "verify", label: "Verify" },
  { key: "report", label: "Report" },
] as const;

export default function Page() {
  const router = useRouter();
  const { state, start } = useInvestigation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<{ points: TimelinePoint[]; markers: TimelineMarker[] }>({
    points: [],
    markers: [],
  });
  const [offline, setOffline] = useState(false);

  // Middleware only checks that a cookie exists. This is where the session is
  // actually verified, so a forged or expired cookie lands on sign-in rather
  // than on an empty console.
  useEffect(() => {
    let cancelled = false;
    fetchMe().then((me) => {
      if (cancelled) return;
      if (!me) {
        router.replace("/signin?next=/console");
        return;
      }
      setUser(me);
      setCheckingSession(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (checkingSession) return;
    Promise.all([
      fetch(`${API_BASE}/api/incident`, { credentials: "include" }).then((r) => r.json()),
      fetch(`${API_BASE}/api/timeline`, { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([i, t]) => {
        setIncident(i);
        setTimeline(t);
      })
      .catch(() => setOffline(true));
  }, [checkingSession]);

  async function onSignOut() {
    await signOut().catch(() => undefined);
    router.replace("/signin");
    router.refresh();
  }

  const running = state.status === "running";
  const resolved = state.status === "resolved";
  const reachedPhase = (key: string) => {
    const order = PHASES.findIndex((p) => p.key === state.phase);
    const mine = PHASES.findIndex((p) => p.key === key);
    return resolved || (order >= 0 && mine < order);
  };

  if (checkingSession) {
    return (
      <div className="surface-dark">
        <main className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
          <p className="text-sm text-[var(--color-ink-muted)]">Checking your session…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="surface-dark">
    <main className="mx-auto max-w-6xl px-6 py-7">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <a href="/" className="text-lg font-semibold tracking-tight transition hover:opacity-70">
            IncidentOS
          </a>
          <span className="text-xs text-[var(--color-ink-muted)]">Investigate. Fix. Verify.</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full ${running ? "pulsing" : ""}`}
            style={{
              background: state.demoMode
                ? "var(--color-status-warning)"
                : running
                  ? "var(--color-status-good)"
                  : "var(--color-ink-muted)",
            }}
          />
          <span className="uppercase tracking-wide text-[var(--color-ink-muted)]">
            {state.demoMode ? "Demo mode" : running ? "Live" : "Idle"}
          </span>

          <span aria-hidden className="mx-1 h-3 w-px bg-[var(--color-ink-muted)] opacity-40" />

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

      {offline && (
        <div className="panel mb-5 border-[var(--color-status-critical)]/40 p-4 text-sm">
          <p className="font-medium">Unable to reach the investigation engine.</p>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            Start it with <code className="font-mono">pnpm dev:server</code> — expected at {API_BASE}.
          </p>
        </div>
      )}

      {state.demoMode && (
        <div className="panel mb-5 border-[var(--color-status-warning)]/40 p-3 text-sm">
          <span className="font-medium text-[var(--color-status-warning)]">DEMO MODE</span>
          <span className="ml-2 text-[var(--color-ink-secondary)]">
            {state.demoMode} Replaying a recorded investigation.
          </span>
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/* Incident card                                               */}
      {/* ---------------------------------------------------------- */}
      <section className="panel mb-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="font-mono text-xs text-[var(--color-ink-muted)]">
              INCIDENT #{incident?.number ?? "—"}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">
              {incident?.title ?? "Loading incident…"}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-ink-secondary)]">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: "var(--color-status-critical)" }}
                />
                {incident?.severity ?? "—"}
              </span>
              <span className="font-mono">{incident?.service ?? "—"}</span>
              <span className="text-[var(--color-ink-muted)]">
                started {incident?.startedAt.slice(11, 16) ?? "—"}
              </span>
              <span
                className="rounded px-2 py-0.5 text-[11px] uppercase tracking-wide"
                style={{
                  background: resolved
                    ? "color-mix(in srgb, var(--color-status-good) 18%, transparent)"
                    : "color-mix(in srgb, var(--color-status-warning) 18%, transparent)",
                  color: resolved ? "var(--color-status-good)" : "var(--color-status-warning)",
                }}
              >
                {resolved ? "Resolved" : (incident?.status ?? "—")}
              </span>
            </div>
          </div>

          <dl className="flex gap-7">
            <Stat
              label="Error rate"
              value={incident ? `${incident.metrics.errorRatePercent}%` : "—"}
              tone="var(--color-series-errors)"
            />
            <Stat
              label="Peak memory"
              value={incident ? `${incident.metrics.memoryPercent}%` : "—"}
              tone="var(--color-series-memory)"
            />
            <Stat
              label="Pods restarting"
              value={incident ? `${incident.metrics.podsRestarting}/${incident.metrics.podsTotal}` : "—"}
            />
          </dl>
        </div>

        <div className="mt-4 border-t border-[var(--color-hairline)] pt-3">
          <IncidentChart points={timeline.points} markers={timeline.markers} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4">
          <button
            onClick={start}
            disabled={running}
            className="rounded-md px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed"
            style={{
              background: running ? "var(--color-inset)" : "var(--color-ink)",
              color: running ? "var(--color-ink-muted)" : "#000",
            }}
          >
            {running ? "Investigating…" : resolved ? "Investigate again" : "Investigate incident"}
          </button>

          {(running || resolved) && (
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              {PHASES.map((phase, i) => {
                const active = state.phase === phase.key;
                const done = reachedPhase(phase.key);
                return (
                  <li key={phase.key} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-[var(--color-ink-muted)]">›</span>}
                    <span
                      className={active ? "pulsing" : ""}
                      style={{
                        color: active
                          ? "var(--color-status-warning)"
                          : done
                            ? "var(--color-status-good)"
                            : "var(--color-ink-muted)",
                      }}
                    >
                      {done ? "✓ " : active ? "◉ " : "○ "}
                      {phase.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {resolved && (
            <span className="ml-auto text-xs text-[var(--color-ink-muted)] tabular">
              completed in {(state.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      </section>

      {state.status !== "idle" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="Investigation"
            accessory={
              state.phaseLabel ? (
                <span className="text-xs text-[var(--color-ink-muted)]">{state.phaseLabel}</span>
              ) : null
            }
            className="lg:col-span-2"
          >
            <ActivityFeed items={state.activity} running={running} />
          </Panel>

          <Panel title="Root-cause hypotheses">
            <Hypotheses hypotheses={state.hypotheses} />
          </Panel>

          <div className="space-y-5">
            <Panel title="Root cause">
              {state.rootCause ? (
                <div className="enter">
                  <div className="mb-2 flex items-baseline gap-3">
                    <span
                      className="text-xs font-semibold uppercase tracking-wide"
                      style={{ color: "var(--color-status-good)" }}
                    >
                      Identified
                    </span>
                    <span className="text-xs text-[var(--color-ink-muted)] tabular">
                      {state.rootCause.confidence}% confidence
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[var(--color-ink-secondary)]">
                    {state.rootCause.explanation}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-ink-muted)]">
                  Not established yet — the agent cannot declare a cause until the evidence supports one
                  hypothesis and rules out the others.
                </p>
              )}
            </Panel>

            <Panel title="Verification">
              <Verification state={state} />
            </Panel>
          </div>

          {state.patches.length > 0 && (
            <Panel title="Code change" className="lg:col-span-2">
              <div className="space-y-4">
                {state.patches.map((patch, i) => (
                  <div key={i} className="enter">
                    <p className="mb-2 font-mono text-xs text-[var(--color-ink-secondary)]">{patch.path}</p>
                    <Diff diff={patch.diff} />
                    <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">{patch.rationale}</p>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {resolved && (
            <section className="panel lg:col-span-2 border-[var(--color-status-good)]/40 p-5 text-center">
              <p
                className="text-xl font-semibold tracking-tight"
                style={{ color: "var(--color-status-good)" }}
              >
                INCIDENT RESOLVED
              </p>
            </section>
          )}

          {state.report && (
            <Panel
              title="Incident report"
              className="lg:col-span-2"
              accessory={
                <button
                  onClick={() => downloadReport(state.report!, incident?.id ?? "incident")}
                  className="rounded border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-secondary)] transition hover:text-[var(--color-ink)]"
                >
                  Export Markdown
                </button>
              }
            >
              <Report markdown={state.report} />
            </Panel>
          )}
        </div>
      )}
    </main>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="mt-0.5 text-2xl font-semibold tabular" style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
    </div>
  );
}

function downloadReport(markdown: string, id: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${id}-report.md`;
  link.click();
  URL.revokeObjectURL(url);
}
