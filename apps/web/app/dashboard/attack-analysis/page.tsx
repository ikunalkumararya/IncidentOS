"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/panels";
import { AttackChart } from "@/components/AttackChart";
import type { AttackAnalysis } from "@/lib/types";
import { API_BASE } from "@/lib/useInvestigation";

export default function AttackAnalysisPage() {
  const [data, setData] = useState<AttackAnalysis | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/attack-analysis`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setData)
      .catch(() => setOffline(true));
  }, []);

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

  const { campaign, points, sources, events } = data;
  const blockedPercent = Math.round((campaign.totals.rateLimited / campaign.totals.maliciousAttempts) * 100);

  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold tracking-tight">Attack analysis</h1>
        <div className="flex items-center gap-2 text-xs">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--color-status-good)" }}
          />
          <span className="uppercase tracking-wide text-[var(--color-ink-muted)]">{campaign.status}</span>
        </div>
      </header>

      {/* ---------------------------------------------------------- */}
      {/* Campaign card                                               */}
      {/* ---------------------------------------------------------- */}
      <section className="panel mb-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              {campaign.id} · {campaign.severity}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">{campaign.title}</h2>
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

        <div className="mt-6">
          <AttackChart points={points} markers={campaign.markers} />
        </div>
      </section>

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
