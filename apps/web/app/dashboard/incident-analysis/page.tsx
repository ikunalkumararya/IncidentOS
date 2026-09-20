"use client";

import { useEffect, useState } from "react";
import { IncidentChart } from "@/components/IncidentChart";
import {
  ActivityFeed,
  Diff,
  Hypotheses,
  Panel,
  PhaseStepper,
  Report,
  RootCauseCard,
  Verification,
} from "@/components/panels";
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

export default function IncidentAnalysisPage() {
  const { state, start } = useInvestigation();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<{ points: TimelinePoint[]; markers: TimelineMarker[] }>({
    points: [],
    markers: [],
  });
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/incident`, { credentials: "include" }).then((r) => r.json()),
      fetch(`${API_BASE}/api/timeline`, { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([i, t]) => {
        setIncident(i);
        setTimeline(t);
      })
      .catch(() => setOffline(true));
  }, []);

  const running = state.status === "running";
  const resolved = state.status === "resolved";
  const reachedIndex = resolved ? PHASES.length : PHASES.findIndex((p) => p.key === state.phase);

  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold tracking-tight">Incident analysis</h1>
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
              background: running ? "var(--color-inset)" : "var(--color-clay-deep)",
              color: running ? "var(--color-ink-muted)" : "#fffefa",
            }}
          >
            {running ? "Investigating…" : resolved ? "Investigate again" : "Investigate incident"}
          </button>

          {(running || resolved) && (
            <PhaseStepper phases={PHASES} current={state.phase} reachedIndex={reachedIndex} />
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
              <RootCauseCard rootCause={state.rootCause} hypotheses={state.hypotheses} />
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
    </>
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
