"use client";

import { useEffect, useRef } from "react";
import type { ActivityItem, HypothesisState, InvestigationState } from "@/lib/useInvestigation";

export function Panel({
  title,
  children,
  accessory,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  accessory?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-4 ${className}`}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="panel-title">{title}</h2>
        {accessory}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Live activity — the "see Claude working" requirement (spec §15)      */
/* ------------------------------------------------------------------ */

export function ActivityFeed({ items, running }: { items: ActivityItem[]; running: boolean }) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items.length]);

  if (!items.length) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        {running ? "Connecting to the investigation engine…" : "No activity yet."}
      </p>
    );
  }

  return (
    <div className="scroll-area max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
      {items.map((item) => (
        <ActivityRow key={item.key} item={item} />
      ))}
      <div ref={end} />
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  if (item.kind === "thinking") {
    return (
      <div className="enter border-l-2 border-[var(--color-baseline)] py-1 pl-3 text-[13px] leading-relaxed text-[var(--color-ink-muted)] italic">
        {item.label}
      </div>
    );
  }

  if (item.kind === "narration") {
    return <div className="enter py-0.5 text-[13px] text-[var(--color-ink-muted)]">{item.label}</div>;
  }

  if (item.kind === "error") {
    return (
      <div className="enter rounded border border-[var(--color-status-critical)]/40 bg-[var(--color-status-critical)]/10 px-3 py-2 text-[13px] text-[var(--color-ink-secondary)]">
        {item.label}
      </div>
    );
  }

  return (
    <div className="enter flex items-baseline gap-2.5 py-0.5 font-mono text-[12.5px]">
      <span
        aria-hidden
        className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${item.pending ? "pulsing" : ""}`}
        style={{
          background: item.pending
            ? "var(--color-status-warning)"
            : item.ok
              ? "var(--color-status-good)"
              : "var(--color-status-critical)",
        }}
      />
      <span className="shrink-0 text-[var(--color-ink)]">{item.label}</span>
      <span className="truncate text-[var(--color-ink-muted)]">{item.detail}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hypotheses and their evidence                                        */
/* ------------------------------------------------------------------ */

export function Hypotheses({ hypotheses }: { hypotheses: HypothesisState[] }) {
  if (!hypotheses.length) {
    return (
      <p className="text-sm text-[var(--color-ink-muted)]">
        Waiting for the agent to propose candidate causes.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {hypotheses.map((h, index) => (
        <li
          key={h.id}
          className={`enter rounded-md border p-3 ${
            h.verdict === "confirmed"
              ? "border-[var(--color-status-good)]/50 bg-[var(--color-status-good)]/[0.07]"
              : h.verdict === "eliminated"
                ? "border-[var(--color-hairline)] opacity-55"
                : "border-[var(--color-hairline)]"
          }`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">
              <span className="mr-2 text-[var(--color-ink-muted)] tabular">{index + 1}.</span>
              {h.hypothesis}
              {h.verdict === "eliminated" && (
                <span className="ml-2 text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">
                  ruled out
                </span>
              )}
            </p>
            <span className="shrink-0 text-xs text-[var(--color-ink-muted)] tabular">{h.confidence}%</span>
          </div>

          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-inset)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${h.confidence}%`,
                background:
                  h.verdict === "confirmed" ? "var(--color-status-good)" : "var(--color-series-memory)",
              }}
            />
          </div>

          {h.evidence.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {h.evidence.map((e, i) => (
                <li key={i} className="enter flex items-start gap-2 text-[13px] leading-snug">
                  <span
                    aria-hidden
                    className="mt-[3px] shrink-0 font-bold"
                    style={{
                      color: e.supports ? "var(--color-status-good)" : "var(--color-status-critical)",
                    }}
                  >
                    {e.supports ? "✓" : "✗"}
                  </span>
                  <span className="text-[var(--color-ink-secondary)]">
                    <span className="sr-only">{e.supports ? "Supports: " : "Contradicts: "}</span>
                    {e.evidence}
                    <span className="ml-1.5 font-mono text-[11px] text-[var(--color-ink-muted)]">
                      {e.source}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Diff                                                                 */
/* ------------------------------------------------------------------ */

export function Diff({ diff }: { diff: string }) {
  return (
    <pre className="scroll-area overflow-x-auto rounded-md bg-[var(--color-inset)] p-3 font-mono text-[12.5px] leading-[1.55]">
      {diff.split("\n").map((line, i) => {
        const added = line.startsWith("+") && !line.startsWith("+++");
        const removed = line.startsWith("-") && !line.startsWith("---");
        const meta = line.startsWith("@@") || line.startsWith("+++") || line.startsWith("---");
        return (
          <div
            key={i}
            style={{
              color: added
                ? "var(--color-status-good)"
                : removed
                  ? "var(--color-status-critical)"
                  : meta
                    ? "var(--color-ink-muted)"
                    : "var(--color-ink-secondary)",
              background: added
                ? "color-mix(in srgb, var(--color-status-good) 10%, transparent)"
                : removed
                  ? "color-mix(in srgb, var(--color-status-critical) 10%, transparent)"
                  : undefined,
            }}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

/* ------------------------------------------------------------------ */
/* Verification                                                         */
/* ------------------------------------------------------------------ */

export function Verification({ state }: { state: InvestigationState }) {
  const { verifications, tests, memory } = state;

  if (!verifications.length && !tests && !memory) {
    return <p className="text-sm text-[var(--color-ink-muted)]">Nothing verified yet.</p>;
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {verifications.map((v) => (
          <li key={v.check} className="enter flex items-start gap-2 text-sm">
            <span
              aria-hidden
              className="mt-[1px] shrink-0 font-bold"
              style={{ color: v.ok ? "var(--color-status-good)" : "var(--color-status-critical)" }}
            >
              {v.ok ? "✓" : "✗"}
            </span>
            <span>
              <span className="sr-only">{v.ok ? "Passed: " : "Failed: "}</span>
              {v.check}
              <span className="ml-2 text-[var(--color-ink-muted)]">{v.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {tests && (
        <div className="rounded-md bg-[var(--color-inset)] p-3">
          <p className="text-2xl font-semibold tabular">
            <span style={{ color: tests.failed === 0 ? "var(--color-status-good)" : "var(--color-status-critical)" }}>
              {tests.passed}
            </span>
            <span className="text-[var(--color-ink-muted)]"> / {tests.total}</span>
            <span className="ml-2 text-sm font-normal text-[var(--color-ink-secondary)]">tests passed</span>
          </p>
          {tests.failures.length > 0 && (
            <ul className="mt-2 space-y-1 font-mono text-[12px] text-[var(--color-status-critical)]">
              {tests.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {memory && (
        <div className="rounded-md bg-[var(--color-inset)] p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">
            Memory simulation · 25,000 captures
          </p>
          <div className="flex items-baseline gap-3 tabular">
            <span className="text-xl" style={{ color: "var(--color-series-errors)" }}>
              {memory.beforeMB} MB
            </span>
            <span className="text-[var(--color-ink-muted)]">→</span>
            <span className="text-xl" style={{ color: "var(--color-status-good)" }}>
              {memory.afterMB} MB
            </span>
            <span className="text-sm text-[var(--color-ink-secondary)]">
              {memory.reductionPercent}% less retained
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)] tabular">
            {memory.beforePerTxn} → {memory.afterPerTxn} bytes retained per transaction
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Incident report                                                      */
/* ------------------------------------------------------------------ */

/**
 * Minimal Markdown rendering — headings, bullets, bold and inline code are
 * everything the report prompt asks for, so pulling in a full parser (and its
 * sanitiser) would be more risk than it removes.
 */
export function Report({ markdown }: { markdown: string }) {
  const blocks = markdown.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {blocks.map((line, i) => {
        if (/^#{1,3}\s/.test(line)) {
          return (
            <h3 key={i} className="pt-3 panel-title">
              {line.replace(/^#+\s/, "")}
            </h3>
          );
        }
        if (/^\s*[-*•]\s/.test(line)) {
          return (
            <p key={i} className="flex gap-2 pl-1 text-[var(--color-ink-secondary)]">
              <span aria-hidden className="text-[var(--color-ink-muted)]">
                •
              </span>
              <span>{inline(line.replace(/^\s*[-*•]\s/, ""))}</span>
            </p>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return (
          <p key={i} className="text-[var(--color-ink-secondary)]">
            {inline(line)}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[var(--color-ink)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-[var(--color-inset)] px-1 py-0.5 font-mono text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
