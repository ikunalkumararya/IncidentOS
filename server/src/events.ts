/**
 * The contract between the agent and the dashboard (spec §13).
 *
 * Most of these are emitted by tool calls rather than parsed out of prose:
 * `report_hypothesis`, `report_evidence` and `report_root_cause` exist purely
 * so the structured findings arrive as typed events while the model is still
 * working, instead of having to be recovered from its final text.
 */
export type InvestigationEvent =
  | { type: "started"; incidentId: string; message: string }
  | { type: "phase"; phase: Phase; label: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; summary: string; ok: boolean }
  | { type: "hypothesis"; id: string; hypothesis: string; confidence: number; rationale: string }
  | { type: "evidence"; hypothesisId: string; evidence: string; supports: boolean; source: string }
  | { type: "root_cause"; explanation: string; confidence: number; hypothesisId: string }
  | { type: "patch"; path: string; diff: string; rationale: string }
  | { type: "verification"; check: string; ok: boolean; detail: string }
  | { type: "test"; passed: number; failed: number; total: number; failures: string[] }
  | { type: "memory"; beforeMB: number; afterMB: number; beforePerTxn: number; afterPerTxn: number; reductionPercent: number }
  | { type: "report"; markdown: string }
  | { type: "narration"; text: string }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "demo_mode"; reason: string }
  | { type: "resolved"; durationMs: number };

export type Phase = "investigate" | "hypothesize" | "prove" | "fix" | "verify" | "report";

export const PHASE_LABELS: Record<Phase, string> = {
  investigate: "Gathering incident context",
  hypothesize: "Generating root-cause hypotheses",
  prove: "Testing hypotheses against evidence",
  fix: "Locating and patching the defect",
  verify: "Verifying the fix",
  report: "Writing the incident report",
};

/** An event as it goes over the wire: `at` is ms since the run started. */
export type TimedEvent = InvestigationEvent & { at: number; seq: number };

export type Emit = (event: InvestigationEvent) => void;

/**
 * Collects events, stamps them with a relative timestamp, and fans them out to
 * live subscribers. The relative timestamp is what lets a recording be
 * replayed later with its original pacing.
 */
export class EventStream {
  private readonly startedAt = Date.now();
  private readonly events: TimedEvent[] = [];
  private readonly subscribers = new Set<(event: TimedEvent) => void>();
  private seq = 0;
  private closed = false;

  emit: Emit = (event) => {
    if (this.closed) return;
    const timed: TimedEvent = { ...event, at: Date.now() - this.startedAt, seq: this.seq++ };
    this.events.push(timed);
    for (const subscriber of this.subscribers) subscriber(timed);
  };

  /** Subscribes, replaying everything emitted so far first. */
  subscribe(subscriber: (event: TimedEvent) => void): () => void {
    for (const event of this.events) subscriber(event);
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  close(): void {
    this.closed = true;
    this.subscribers.clear();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  snapshot(): TimedEvent[] {
    return [...this.events];
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}
