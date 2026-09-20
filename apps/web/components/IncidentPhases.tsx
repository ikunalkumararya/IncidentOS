"use client";

import { useEffect, useState } from "react";

/**
 * The phase-by-phase view of an intake investigation.
 *
 * Every timing here is measured: a finished phase shows the elapsed time the
 * worker recorded around the call it made, and the running phase counts up
 * from the timestamp the worker wrote when it started. Nothing is animated to
 * look like progress — a phase that is slow looks slow, and a stalled
 * investigation stops moving.
 */

export type PhaseRow = {
  seq: number;
  phase: string;
  status: "running" | "done" | "failed";
  output: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
};

export type PhasePlanItem = { key: string; label: string; running: string };

type State = "pending" | "running" | "done" | "failed";

const DOT: Record<State, string> = {
  pending: "var(--color-baseline)",
  running: "var(--color-status-warning)",
  done: "var(--color-status-good)",
  failed: "var(--color-status-critical)",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

/** Ticks once a second, but only while something is actually running. */
function useElapsed(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function IncidentPhases({
  plan,
  phases,
  status,
  onReviewReport,
}: {
  plan: PhasePlanItem[];
  phases: PhaseRow[];
  status: string;
  onReviewReport: () => void;
}) {
  const byKey = new Map(phases.map((p) => [p.phase, p]));
  const running = phases.some((p) => p.status === "running") && status === "investigating";
  const now = useElapsed(running);

  // Only count phases that finished. A running phase has no measured duration
  // yet, and adding its live elapsed time would make the total jump backwards
  // when the real figure lands.
  const settled = phases.filter((p) => p.duration_ms !== null);
  const total = settled.reduce((sum, p) => sum + (p.duration_ms ?? 0), 0);
  const done = phases.filter((p) => p.status === "done").length;
  const complete = status === "review";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Investigation</h3>
        <p className="text-xs text-[var(--color-ink-muted)]">
          {done} of {plan.length} phases
          {total > 0 && <> · {formatDuration(total)} of model time</>}
        </p>
      </div>

      <ol className="space-y-1">
        {plan.map((item, index) => {
          const row = byKey.get(item.key);
          const state: State = row ? row.status : "pending";
          const isLast = index === plan.length - 1;

          return (
            <li key={item.key} className="flex gap-3">
              {/* The rail: a dot per phase, joined by a line except after the last. */}
              <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${state === "running" ? "animate-pulse" : ""}`}
                  style={{ background: DOT[state] }}
                />
                {!isLast && <span className="mt-1 w-px flex-1 bg-[var(--color-hairline)]" />}
              </div>

              <div className={`min-w-0 flex-1 ${isLast ? "pb-0" : "pb-4"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p
                    className={`text-sm ${state === "pending" ? "text-[var(--color-ink-muted)]" : "font-medium"}`}
                  >
                    {item.label}
                  </p>
                  <p className="font-mono text-xs tabular text-[var(--color-ink-muted)]">
                    {state === "done" && row?.duration_ms !== null && formatDuration(row!.duration_ms!)}
                    {state === "running" &&
                      row &&
                      formatDuration(Math.max(0, now - Date.parse(row.started_at)))}
                    {state === "failed" && "stopped"}
                    {state === "pending" && "—"}
                  </p>
                </div>

                {state === "running" && (
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{item.running}</p>
                )}
                {state === "failed" && (
                  <p className="mt-1 text-xs text-[var(--color-status-critical)]">
                    This phase did not finish. The investigation stopped here.
                  </p>
                )}

                {/*
                  The last phase's output is the report itself, rendered in full
                  below — repeating it here as raw text would show the same
                  thing twice.
                */}
                {state === "done" && row?.output && !isLast && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                      What it found
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-[var(--color-hairline)] pl-3 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
                      {row.output}
                    </p>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {complete && (
        <div
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
          style={{
            borderColor: "color-mix(in srgb, var(--color-clay) 35%, transparent)",
            background: "color-mix(in srgb, var(--color-clay) 7%, transparent)",
          }}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">The investigation is finished. Read the report.</p>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              Its conclusions are unverified — it had only this report and its evidence to work from,
              and nothing has been changed in any system.
            </p>
          </div>
          <button
            type="button"
            onClick={onReviewReport}
            className="min-h-10 shrink-0 rounded-lg bg-[var(--color-clay-deep)] px-4 text-sm font-medium text-[#fffefa] transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-clay-deep)]"
          >
            Review the report
          </button>
        </div>
      )}
    </div>
  );
}
