"use client";

import { useEffect, useState } from "react";
import { LiveHealthChart } from "@/components/LiveHealthChart";
import {
  ActivityFeed,
  Diff,
  Hypotheses,
  Panel,
  PhaseStepper,
  Report,
  RootCauseCard,
  Tag,
  Verification,
} from "@/components/panels";
import { visibleCount } from "@/lib/playback";
import type { AttackAnalysis } from "@/lib/types";
import { API_BASE, useInvestigation } from "@/lib/useInvestigation";

const PHASES = [
  { key: "investigate", label: "Telemetry" },
  { key: "hypothesize", label: "Hypotheses" },
  { key: "prove", label: "Evidence" },
  { key: "fix", label: "Harden" },
  { key: "verify", label: "Verify" },
  { key: "report", label: "Report" },
] as const;

interface K8sEventRaw {
  timestamp: string;
  type: string;
  reason: string;
  object: string;
  message: string;
  count: number;
}

function priorityTone(priority: string | undefined): "good" | "warning" | "critical" | "neutral" {
  if (priority === "Urgent") return "critical";
  if (priority === "Major") return "warning";
  if (priority === "Minor") return "good";
  return "neutral";
}

export default function AttackAnalysisPage() {
  const { state, start } = useInvestigation("attack");
  const [data, setData] = useState<AttackAnalysis | null>(null);
  const [offline, setOffline] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [k8sEvents, setK8sEvents] = useState<K8sEventRaw[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/attack-analysis`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setData)
      .catch(() => setOffline(true));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/logs?stream=payments-api-errors&limit=120`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { lines: string[] }) => setLogs(d.lines))
      .catch(() => undefined);
    fetch(`${API_BASE}/api/kubernetes-events`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { events: K8sEventRaw[] }) => setK8sEvents(d.events))
      .catch(() => undefined);
  }, [state.status === "resolved"]);

  const running = state.status === "running";
  const resolved = state.status === "resolved";
  const failed = state.status === "failed";
  const reachedIndex = resolved ? PHASES.length : PHASES.findIndex((p) => p.key === state.phase);

  if (offline) {
    return (
      <div className="panel border-[var(--color-status-critical)]/40 p-4 text-sm">
        <p className="font-medium">Unable to load the attack analysis.</p>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          Start the server with <code className="font-mono">pnpm dev:server</code> — expected at {API_BASE}.
        </p>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-[var(--color-ink-muted)]">Loading attack analysis…</p>;
  }

  const { campaign, points, sources, events, health, healthMarkers } = data;
  const blockedPercent =
    campaign.totals.maliciousAttempts > 0
      ? Math.round((campaign.totals.rateLimited / campaign.totals.maliciousAttempts) * 100)
      : 0;
  const durationMin = Math.round(
    (new Date(campaign.containedAt).getTime() - new Date(campaign.startedAt).getTime()) / 60_000,
  );

  const dimBeyondCursor = running;
  const healthShown = visibleCount(state, health.length);
  const cursorTime = healthShown > 0 ? health[Math.min(healthShown, health.length) - 1].t : null;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Attack analysis</h1>
        <div className="flex items-center gap-2">
          <Tag tone={priorityTone(state.assessment?.priority)}>{state.assessment?.priority ?? "Unassessed"}</Tag>
          <Tag tone="neutral">{state.assessment ? `${state.assessment.confidence}% conf` : "— conf"}</Tag>
        </div>
      </header>

      {failed && state.error && (
        <div className="panel mb-5 border-[var(--color-status-critical)]/40 p-4 text-sm">
          <p className="font-medium">The investigation failed.</p>
          <p className="mt-1 text-[var(--color-ink-muted)]">{state.error}</p>
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/* Attack report card                                          */}
      {/* ---------------------------------------------------------- */}
      <section className="panel mb-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-[var(--color-ink-muted)]">
              {campaign.id} · {campaign.severity}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">{campaign.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-ink-secondary)]">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 rounded-full ${running ? "pulsing" : ""}`}
                  style={{ background: running ? "var(--color-status-warning)" : "var(--color-status-good)" }}
                />
                {campaign.status}
              </span>
              {/* Illustrative wording — the campaign fixture only names the service,
                  not a specific database, so this stays honest about the target. */}
              <span className="font-mono">{campaign.service} · account store</span>
              <span className="text-[var(--color-ink-muted)]">
                start {campaign.startedAt.slice(11, 16)} · duration {durationMin}m
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {campaign.technique} · {campaign.mitre.id} {campaign.mitre.name} · {campaign.targetEndpoint}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Attempts" value={campaign.totals.maliciousAttempts.toLocaleString()} />
          <Stat label="Rate limited" value={`${blockedPercent}%`} tone="var(--color-status-good)" />
          <Stat
            label="Sources"
            value={`${campaign.totals.uniqueSources} · ${campaign.totals.countries} countries`}
          />
          <Stat
            label="Sessions created"
            value={String(campaign.totals.sessionsCreated)}
            tone={
              campaign.totals.sessionsCreated > 0
                ? "var(--color-status-critical)"
                : "var(--color-status-good)"
            }
          />
        </div>

        <div className="mt-4 border-t border-[var(--color-hairline)] pt-3 text-sm">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">Code location</span>{" "}
          {state.codeLocation ? (
            <span className="font-mono">
              {state.codeLocation.path}:{state.codeLocation.line} · {state.codeLocation.symbol}
            </span>
          ) : (
            <span className="text-[var(--color-ink-muted)]">not yet located</span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            onClick={start}
            disabled={running}
            className="rounded-md px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed"
            style={{
              background: running ? "var(--color-inset)" : "var(--color-clay-deep)",
              color: running ? "var(--color-ink-muted)" : "#fffefa",
            }}
          >
            {running ? "Investigating…" : resolved ? "Investigate again" : "Investigate attack"}
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

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Panel title="Live health metrics">
            <LiveHealthChart points={points} markers={campaign.markers} health={health} healthMarkers={healthMarkers} playback={state} />
          </Panel>

          {state.status !== "idle" && (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="Root-cause hypotheses">
                  <Hypotheses hypotheses={state.hypotheses} />
                </Panel>
                <Panel title="Root cause">
                  <RootCauseCard rootCause={state.rootCause} hypotheses={state.hypotheses} />
                </Panel>
              </div>

              <Panel title="Verification">
                <Verification state={state} attackSim={state.attackSim} />
              </Panel>

              {state.patches.length > 0 && (
                <Panel title="Code change">
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

              {state.report && (
                <Panel
                  title="Security report"
                  accessory={
                    <button
                      onClick={() => downloadReport(state.report!, campaign.id)}
                      className="rounded border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-secondary)] transition hover:text-[var(--color-ink)]"
                    >
                      Export Markdown
                    </button>
                  }
                >
                  <Report markdown={state.report} />
                </Panel>
              )}
            </>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Attributed sources">
              <div className="space-y-2">
                {sources.map((s) => (
                  <div
                    key={s.ip}
                    className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-muted)]/10 pb-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-[13px]">{s.ip}</p>
                      <p className="truncate text-[11.5px] text-[var(--color-ink-muted)]">
                        {s.country} · {s.asn} {s.org}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px]">{s.attempts.toLocaleString()}</p>
                      <p className="text-[11.5px] uppercase tracking-wide text-[var(--color-status-good)]">
                        {s.status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Credentials that matched">
              <div className="space-y-2">
                {campaign.compromised.map((c) => (
                  <div
                    key={c.account}
                    className="flex items-center justify-between gap-3 border-b border-[var(--color-ink-muted)]/10 pb-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12.5px]">{c.account}</p>
                      <p className="text-[11.5px] text-[var(--color-ink-muted)]">
                        {c.at.slice(11, 16)} · MFA {c.mfa.replace(/_/g, " ")}
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-[11.5px] uppercase tracking-wide"
                      style={{
                        color:
                          c.outcome === "session_created"
                            ? "var(--color-status-critical)"
                            : "var(--color-status-good)",
                      }}
                    >
                      {c.outcome.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* The question anyone looking at both tabs will ask. Answering it
              here, with the reasoning, is the point of showing them together. */}
          <Panel title={`Relationship to ${campaign.relatedIncident.id}`}>
            <p className="text-[12px] uppercase tracking-wide text-[var(--color-status-good)]">
              {campaign.relatedIncident.relationship}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              {campaign.relatedIncident.rationale}
            </p>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <LogsPanel lines={logs} cursorTime={cursorTime} dimBeyondCursor={dimBeyondCursor} />
            <KubernetesPanel events={k8sEvents} cursorTime={cursorTime} dimBeyondCursor={dimBeyondCursor} />
          </div>
        </div>

        <div className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <Panel title="Control timeline">
            <ol className="space-y-3">
              {events.map((e) => (
                <li key={`${e.timestamp}-${e.title}`} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: SEVERITY_COLOUR[e.severity] }}
                  />
                  <div className="min-w-0">
                    <p className="text-[13px]">
                      <span className="font-mono text-[11.5px] text-[var(--color-ink-muted)]">
                        {e.timestamp.slice(11, 16)}
                      </span>{" "}
                      {e.title}
                    </p>
                    <p className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]">{e.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel
            title="Investigation"
            accessory={
              state.phaseLabel ? (
                <span className="text-xs text-[var(--color-ink-muted)]">{state.phaseLabel}</span>
              ) : null
            }
          >
            <ActivityFeed items={state.activity} running={running} />
          </Panel>
        </div>
      </div>
    </>
  );
}

const SEVERITY_COLOUR: Record<string, string> = {
  info: "var(--color-ink-muted)",
  warning: "var(--color-status-warning)",
  critical: "var(--color-status-critical)",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
  );
}

function withinWindow(timestamp: string, cursorTime: string | null, dimBeyondCursor: boolean): boolean {
  if (!dimBeyondCursor || !cursorTime) return true;
  return timestamp.slice(11, 16) <= cursorTime;
}

function LogsPanel({
  lines,
  cursorTime,
  dimBeyondCursor,
}: {
  lines: string[];
  cursorTime: string | null;
  dimBeyondCursor: boolean;
}) {
  return (
    <Panel title="Logs · payments-api errors">
      <div className="scroll-area max-h-72 space-y-0.5 overflow-y-auto pr-1 font-mono text-[11.5px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">No log lines.</p>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className={withinWindow(line, cursorTime, dimBeyondCursor) ? "text-[var(--color-ink-secondary)]" : "text-[var(--color-ink-muted)] opacity-40"}
            >
              {line}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function KubernetesPanel({
  events,
  cursorTime,
  dimBeyondCursor,
}: {
  events: K8sEventRaw[];
  cursorTime: string | null;
  dimBeyondCursor: boolean;
}) {
  return (
    <Panel title="Kubernetes events">
      <ol className="scroll-area max-h-72 space-y-2 overflow-y-auto pr-1 text-[12px]">
        {events.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">No events.</p>
        ) : (
          events.map((e, i) => (
            <li
              key={i}
              className={withinWindow(e.timestamp, cursorTime, dimBeyondCursor) ? "" : "opacity-40"}
            >
              <span className="font-mono text-[11px] text-[var(--color-ink-muted)]">
                {e.timestamp.slice(11, 16)}
              </span>{" "}
              <span className="font-medium">{e.reason}</span>{" "}
              <span className="text-[var(--color-ink-muted)]">{e.object}</span>
              <p className="text-[11.5px] leading-snug text-[var(--color-ink-secondary)]">{e.message}</p>
            </li>
          ))
        )}
      </ol>
    </Panel>
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
