"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A scripted replay of an investigation, for the landing page.
 *
 * Deliberately self-contained: no server, no API key, no network. The beats
 * mirror the shape of a real run — and the numbers in it are the ones the real
 * run actually produces — so the page can sit on a static host and still show
 * honestly what the product does.
 *
 * Everything on screen is derived from the prefix of BEATS that has played,
 * the same way the console derives its state from the event stream. There is
 * no imperative animation state to get out of sync.
 */

type Beat =
  | { kind: "phase"; hold: number; label: string }
  | { kind: "tool"; hold: number; name: string; detail: string; result: string }
  | { kind: "hypothesis"; hold: number; id: string; text: string; confidence: number }
  | { kind: "evidence"; hold: number; id: string; text: string; supports: boolean }
  | { kind: "rootcause"; hold: number; text: string; confidence: number }
  | { kind: "patch"; hold: number }
  | { kind: "verify"; hold: number }
  | { kind: "resolved"; hold: number };

const BEATS: Beat[] = [
  { kind: "phase", hold: 620, label: "Gathering incident context" },
  { kind: "tool", hold: 620, name: "get_metrics", detail: "memory · perPod", result: "peak 39% → 92%" },
  { kind: "tool", hold: 560, name: "search_logs", detail: "heap out of memory", result: "7 lines matched" },
  { kind: "tool", hold: 560, name: "get_kubernetes_events", detail: "reason: OOMKilling", result: "7 events · exit 137" },
  { kind: "tool", hold: 700, name: "get_deployment_history", detail: "payments-api", result: "v1.8.4 degraded · 14:21" },

  { kind: "phase", hold: 560, label: "Generating root-cause hypotheses" },
  { kind: "hypothesis", hold: 420, id: "memory-leak", text: "Memory leak introduced in v1.8.4", confidence: 64 },
  { kind: "hypothesis", hold: 420, id: "db-pool", text: "Database connection exhaustion", confidence: 41 },
  { kind: "hypothesis", hold: 700, id: "traffic", text: "Traffic spike", confidence: 23 },

  { kind: "phase", hold: 560, label: "Testing hypotheses against evidence" },
  { kind: "evidence", hold: 780, id: "traffic", text: "Requests rose only 8% across the window", supports: false },
  { kind: "evidence", hold: 780, id: "db-pool", text: "Pool peaks at 34/40, wait_queue=0 throughout", supports: false },
  { kind: "tool", hold: 560, name: "search_code", detail: "transactionCache", result: "16 matches" },
  { kind: "tool", hold: 620, name: "read_file", detail: "src/transactions.ts", result: "49 lines" },
  { kind: "evidence", hold: 700, id: "memory-leak", text: "Heap climbs within 1 min of each pod taking v1.8.4", supports: true },
  { kind: "evidence", hold: 900, id: "memory-leak", text: "transactions.ts:28 queues the whole request object", supports: true },

  {
    kind: "rootcause",
    hold: 2000,
    confidence: 94,
    text: "v1.8.4 queues the inbound request instead of a transaction summary, retaining the 4 KiB raw payload per capture until the container reaches its 2Gi limit and is OOM-killed.",
  },

  { kind: "phase", hold: 560, label: "Patching the defect" },
  { kind: "patch", hold: 2100 },
  { kind: "verify", hold: 2600 },
  { kind: "resolved", hold: 2800 },
];

const DIFF = [
  { sign: " ", text: "export function processPayment(req: PaymentRequest) {" },
  { sign: " ", text: "  validatePaymentBody(req.body);" },
  { sign: "-", text: "  transactionCache.push(req);" },
  { sign: "+", text: "  transactionCache.push({" },
  { sign: "+", text: "    id: req.body.id," },
  { sign: "+", text: "    amount: req.body.amount," },
  { sign: "+", text: "    currency: req.body.currency," },
  { sign: "+", text: "  });" },
  { sign: " ", text: "  return aggregateTransaction(req.body);" },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Counts up to `target` once `active` flips true. */
function useCountUp(target: number, active: boolean, duration = 900, decimals = 0): string {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // ease-out-cubic
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, duration]);
  return value.toFixed(decimals);
}

export function DemoReplay() {
  const reduced = usePrefersReducedMotion();
  const container = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [played, setPlayed] = useState(0);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // With reduced motion the whole thing is shown at rest — no loop, no timers.
  useEffect(() => {
    if (reduced) {
      setPlayed(BEATS.length);
      return;
    }
    if (!inView) return;

    let timer: ReturnType<typeof setTimeout>;
    let next = 0;

    const tick = () => {
      if (next > BEATS.length) {
        next = 0;
        setPlayed(0);
        timer = setTimeout(tick, 700);
        return;
      }
      setPlayed(next);
      const hold = BEATS[next]?.hold ?? 1200;
      next += 1;
      timer = setTimeout(tick, hold);
    };

    tick();
    return () => clearTimeout(timer);
  }, [inView, reduced]);

  const view = useMemo(() => {
    const beats = BEATS.slice(0, played);
    const tools: { name: string; detail: string; result: string | null }[] = [];
    const hypotheses: {
      id: string;
      text: string;
      confidence: number;
      evidence: { text: string; supports: boolean }[];
      verdict: "open" | "confirmed" | "eliminated";
    }[] = [];

    let phase = "";
    let rootCause: { text: string; confidence: number } | null = null;
    let patch = false;
    let verify = false;
    let resolved = false;

    for (const beat of beats) {
      switch (beat.kind) {
        case "phase":
          phase = beat.label;
          break;
        case "tool":
          tools.push({ name: beat.name, detail: beat.detail, result: beat.result });
          break;
        case "hypothesis":
          hypotheses.push({ ...beat, evidence: [], verdict: "open" });
          break;
        case "evidence": {
          const target = hypotheses.find((h) => h.id === beat.id);
          target?.evidence.push({ text: beat.text, supports: beat.supports });
          break;
        }
        case "rootcause":
          rootCause = { text: beat.text, confidence: beat.confidence };
          for (const h of hypotheses) {
            h.verdict = h.id === "memory-leak" ? "confirmed" : "eliminated";
          }
          break;
        case "patch":
          patch = true;
          break;
        case "verify":
          verify = true;
          break;
        case "resolved":
          resolved = true;
          break;
      }
    }

    // The last tool call renders as still in flight, which is what gives the
    // feed its sense of live progress.
    const running = played < BEATS.length;
    if (running && tools.length && BEATS[played - 1]?.kind === "tool") {
      tools[tools.length - 1] = { ...tools[tools.length - 1], result: null };
    }

    return { phase, tools, hypotheses, rootCause, patch, verify, resolved, running };
  }, [played]);

  const testsShown = useCountUp(47, view.verify, 900);
  const memoryShown = useCountUp(3.55, view.verify, 1100, 2);

  return (
    <div
      ref={container}
      className="dark-panel overflow-hidden rounded-xl border border-[var(--color-rule-strong)]"
      style={{ boxShadow: "0 24px 60px -32px rgba(25,25,23,0.35)" }}
      aria-label="A replay of an IncidentOS investigation"
    >
      {/* window chrome */}
      <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${view.running ? "pulsing" : ""}`}
            style={{
              background: view.resolved ? "var(--color-status-good)" : "var(--color-status-warning)",
            }}
          />
          <span className="font-mono text-[11px] text-[var(--color-ink-muted)]">
            INC-4821 · payments-api · SEV-1
          </span>
        </div>
        <span className="hidden font-mono text-[11px] text-[var(--color-ink-muted)] sm:block">
          {view.resolved ? "resolved" : view.phase || "standing by"}
        </span>
      </div>

      <div className="grid min-h-[34rem] gap-px bg-[var(--color-hairline)] md:min-h-[33rem] md:grid-cols-[1.05fr_1fr]">
        {/* ---------------- activity feed ---------------- */}
        <div className="min-w-0 overflow-hidden bg-[var(--color-surface)] p-4">
          <p className="panel-title mb-3">Investigation</p>
          <div className="space-y-1.5">
            {view.tools.map((tool, i) => (
              <div
                key={`${tool.name}-${i}`}
                className="enter flex min-w-0 items-baseline gap-2 font-mono text-[11.5px] sm:text-[12px]"
              >
                <span
                  aria-hidden
                  className={`mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    tool.result === null ? "pulsing" : ""
                  }`}
                  style={{
                    background:
                      tool.result === null ? "var(--color-status-warning)" : "var(--color-status-good)",
                  }}
                />
                <span className="truncate text-[var(--color-ink)]">{tool.name}</span>
                {/* The argument is the first thing to go when space is tight —
                    the tool name and its result carry the story on their own. */}
                <span className="hidden min-w-0 truncate text-[var(--color-ink-muted)] sm:block">
                  {tool.detail}
                </span>
                {tool.result && (
                  <span className="ml-auto shrink-0 pl-2 text-[var(--color-ink-secondary)]">
                    {tool.result}
                  </span>
                )}
              </div>
            ))}
            {!view.tools.length && (
              <p className="font-mono text-[12px] text-[var(--color-ink-muted)]">
                waiting for the incident
                <span className="caret">_</span>
              </p>
            )}
          </div>

          {view.patch && (
            <div className="enter mt-4">
              <p className="panel-title mb-2">Patch · src/transactions.ts</p>
              <pre className="scroll-area overflow-x-auto rounded-md bg-[var(--color-inset)] p-2.5 font-mono text-[10.5px] leading-[1.6] sm:text-[11px]">
                {DIFF.map((line, i) => (
                  <div
                    key={i}
                    className="enter"
                    style={{
                      animationDelay: `${i * 55}ms`,
                      color:
                        line.sign === "+"
                          ? "var(--color-status-good)"
                          : line.sign === "-"
                            ? "var(--color-status-critical)"
                            : "var(--color-ink-muted)",
                    }}
                  >
                    {line.sign}
                    {line.text}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>

        {/* ---------------- findings ---------------- */}
        <div className="min-w-0 overflow-hidden bg-[var(--color-surface)] p-4">
          <p className="panel-title mb-3">Hypotheses</p>

          {!view.hypotheses.length && (
            <p className="font-mono text-[12px] text-[var(--color-ink-muted)]">none yet</p>
          )}

          <ol className="space-y-2.5">
            {view.hypotheses.map((h) => (
              <li
                key={h.id}
                className="enter transition-opacity duration-500"
                style={{ opacity: h.verdict === "eliminated" ? 0.42 : 1 }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className="text-[13px] leading-snug"
                    style={{
                      textDecoration: h.verdict === "eliminated" ? "line-through" : undefined,
                      color:
                        h.verdict === "confirmed" ? "var(--color-ink)" : "var(--color-ink-secondary)",
                    }}
                  >
                    {h.text}
                  </p>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--color-ink-muted)] tabular">
                    {h.verdict === "confirmed" ? 94 : h.confidence}%
                  </span>
                </div>

                <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-inset)]">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${h.verdict === "confirmed" ? 94 : h.verdict === "eliminated" ? 6 : h.confidence}%`,
                      background:
                        h.verdict === "confirmed"
                          ? "var(--color-status-good)"
                          : "var(--color-series-memory)",
                    }}
                  />
                </div>

                {h.evidence.map((e, i) => (
                  <p key={i} className="enter mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug">
                    <span
                      aria-hidden
                      className="mt-[1px] shrink-0 font-bold"
                      style={{
                        color: e.supports
                          ? "var(--color-status-good)"
                          : "var(--color-status-critical)",
                      }}
                    >
                      {e.supports ? "✓" : "✗"}
                    </span>
                    <span className="text-[var(--color-ink-muted)]">{e.text}</span>
                  </p>
                ))}
              </li>
            ))}
          </ol>

          {view.rootCause && (
            <div className="enter mt-4 border-t border-[var(--color-hairline)] pt-3">
              <p className="panel-title mb-1.5">
                Root cause ·{" "}
                <span style={{ color: "var(--color-status-good)" }}>
                  {view.rootCause.confidence}% confidence
                </span>
              </p>
              <p className="text-[12.5px] leading-relaxed text-[var(--color-ink-secondary)]">
                {view.rootCause.text}
              </p>
            </div>
          )}

          {view.verify && (
            <div className="enter mt-4 space-y-2.5 border-t border-[var(--color-hairline)] pt-3">
              <p className="panel-title">Verification</p>

              <div className="flex items-baseline gap-2 font-mono text-[12px] tabular">
                <span className="w-16 text-[var(--color-ink-muted)]">tests</span>
                <span style={{ color: "var(--color-status-critical)" }}>46/47</span>
                <span className="text-[var(--color-ink-muted)]">→</span>
                <span className="text-base" style={{ color: "var(--color-status-good)" }}>
                  {testsShown}/47
                </span>
              </div>

              <div className="flex items-baseline gap-2 font-mono text-[12px] tabular">
                <span className="w-16 text-[var(--color-ink-muted)]">memory</span>
                <span style={{ color: "var(--color-series-errors)" }}>112.46 MB</span>
                <span className="text-[var(--color-ink-muted)]">→</span>
                <span className="text-base" style={{ color: "var(--color-status-good)" }}>
                  {memoryShown} MB
                </span>
              </div>

              {/* Retained-bytes bars: the shrink is the whole point, so show it. */}
              <div className="space-y-1 pt-0.5">
                {[
                  { label: "before", width: 100, color: "var(--color-series-errors)" },
                  { label: "after", width: 3.2, color: "var(--color-status-good)" },
                ].map((bar) => (
                  <div key={bar.label} className="flex items-center gap-2">
                    <span className="w-16 font-mono text-[10px] text-[var(--color-ink-muted)]">
                      {bar.label}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-inset)]">
                      <div
                        className="h-full rounded-full transition-all duration-1000 ease-out"
                        style={{ width: `${bar.width}%`, background: bar.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* resolution bar */}
      <div
        className="flex items-center justify-between border-t px-4 py-2.5 transition-colors duration-700"
        style={{
          borderColor: "var(--color-hairline)",
          background: view.resolved
            ? "color-mix(in srgb, var(--color-status-good) 12%, transparent)"
            : "transparent",
        }}
      >
        <span
          className="font-mono text-[11px] tracking-wide transition-colors duration-500"
          style={{
            color: view.resolved ? "var(--color-status-good)" : "var(--color-ink-muted)",
          }}
        >
          {view.resolved ? "INCIDENT RESOLVED" : "INVESTIGATING…"}
        </span>
        <span className="font-mono text-[11px] text-[var(--color-ink-muted)]">
          {reduced ? "static preview" : "replay of a real run"}
        </span>
      </div>
    </div>
  );
}
