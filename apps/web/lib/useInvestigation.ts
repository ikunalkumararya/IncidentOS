"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Phase, TimedEvent } from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export interface HypothesisState {
  id: string;
  hypothesis: string;
  confidence: number;
  rationale: string;
  evidence: { evidence: string; supports: boolean; source: string }[];
  /** Set once the root cause is declared, so the UI can mark the survivor. */
  verdict: "confirmed" | "eliminated" | "open";
}

export interface ActivityItem {
  key: string;
  kind: "tool" | "thinking" | "narration" | "error";
  label: string;
  detail?: string;
  ok: boolean;
  pending: boolean;
}

export interface InvestigationState {
  status: "idle" | "running" | "resolved" | "failed";
  demoMode: string | null;
  phase: Phase | null;
  phaseLabel: string;
  activity: ActivityItem[];
  hypotheses: HypothesisState[];
  rootCause: { explanation: string; confidence: number; hypothesisId: string } | null;
  patches: { path: string; diff: string; rationale: string }[];
  verifications: { check: string; ok: boolean; detail: string }[];
  tests: { passed: number; failed: number; total: number; failures: string[] } | null;
  memory: {
    beforeMB: number;
    afterMB: number;
    beforePerTxn: number;
    afterPerTxn: number;
    reductionPercent: number;
  } | null;
  report: string | null;
  error: string | null;
  durationMs: number;
}

const initialState: InvestigationState = {
  status: "idle",
  demoMode: null,
  phase: null,
  phaseLabel: "",
  activity: [],
  hypotheses: [],
  rootCause: null,
  patches: [],
  verifications: [],
  tests: null,
  memory: null,
  report: null,
  error: null,
  durationMs: 0,
};

function summariseInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  return Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== "" && v !== false)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ·  ")
    .slice(0, 160);
}

/**
 * Folds the event stream into the view model.
 *
 * Written as a pure reducer so that replaying a recording produces exactly the
 * same UI as the live run that produced it — the client cannot tell the two
 * apart, which is the whole point of the fallback.
 */
function reduce(state: InvestigationState, event: TimedEvent): InvestigationState {
  switch (event.type) {
    case "started":
      return { ...state, status: "running" };

    case "demo_mode":
      // The recording replays from the beginning rather than resuming, so the
      // timeline has to be cleared or the two runs would interleave.
      return { ...initialState, status: "running", demoMode: event.reason };

    case "phase":
      return { ...state, phase: event.phase, phaseLabel: event.label };

    case "tool_call":
      return {
        ...state,
        activity: [
          ...state.activity,
          {
            key: `tool-${event.seq}`,
            kind: "tool",
            label: event.tool,
            detail: summariseInput(event.input),
            ok: true,
            pending: true,
          },
        ],
      };

    case "tool_result": {
      // Resolve the most recent pending call for this tool.
      const activity = [...state.activity];
      for (let i = activity.length - 1; i >= 0; i--) {
        if (activity[i].kind === "tool" && activity[i].label === event.tool && activity[i].pending) {
          activity[i] = { ...activity[i], pending: false, ok: event.ok, detail: event.summary };
          break;
        }
      }
      return { ...state, activity };
    }

    case "thinking":
      return {
        ...state,
        activity: [
          ...state.activity,
          { key: `think-${event.seq}`, kind: "thinking", label: event.text, ok: true, pending: false },
        ],
      };

    case "narration":
      return {
        ...state,
        activity: [
          ...state.activity,
          { key: `note-${event.seq}`, kind: "narration", label: event.text, ok: true, pending: false },
        ],
      };

    case "hypothesis":
      return {
        ...state,
        hypotheses: [
          ...state.hypotheses,
          {
            id: event.id,
            hypothesis: event.hypothesis,
            confidence: event.confidence,
            rationale: event.rationale,
            evidence: [],
            verdict: "open",
          },
        ],
      };

    case "evidence":
      return {
        ...state,
        hypotheses: state.hypotheses.map((h) =>
          h.id === event.hypothesisId
            ? {
                ...h,
                evidence: [
                  ...h.evidence,
                  { evidence: event.evidence, supports: event.supports, source: event.source },
                ],
              }
            : h,
        ),
      };

    case "root_cause":
      return {
        ...state,
        rootCause: {
          explanation: event.explanation,
          confidence: event.confidence,
          hypothesisId: event.hypothesisId,
        },
        hypotheses: state.hypotheses.map((h) => ({
          ...h,
          verdict: h.id === event.hypothesisId ? "confirmed" : "eliminated",
        })),
      };

    case "patch":
      return {
        ...state,
        patches: [...state.patches, { path: event.path, diff: event.diff, rationale: event.rationale }],
      };

    case "verification":
      return {
        ...state,
        // A check can run more than once across a repair loop; keep the latest.
        verifications: [
          ...state.verifications.filter((v) => v.check !== event.check),
          { check: event.check, ok: event.ok, detail: event.detail },
        ],
      };

    case "test":
      return {
        ...state,
        tests: {
          passed: event.passed,
          failed: event.failed,
          total: event.total,
          failures: event.failures,
        },
      };

    case "memory":
      return {
        ...state,
        memory: {
          beforeMB: event.beforeMB,
          afterMB: event.afterMB,
          beforePerTxn: event.beforePerTxn,
          afterPerTxn: event.afterPerTxn,
          reductionPercent: event.reductionPercent,
        },
      };

    case "report":
      return { ...state, report: event.markdown };

    case "error":
      return {
        ...state,
        error: event.message,
        status: event.fatal ? "failed" : state.status,
        activity: [
          ...state.activity,
          { key: `err-${event.seq}`, kind: "error", label: event.message, ok: false, pending: false },
        ],
      };

    case "resolved":
      return { ...state, status: "resolved", phase: null, durationMs: event.at };

    default:
      return state;
  }
}

export function useInvestigation() {
  const [state, setState] = useState<InvestigationState>(initialState);
  const sourceRef = useRef<EventSource | null>(null);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    stop();
    setState({ ...initialState, status: "running" });

    let runId: string;
    try {
      const response = await fetch(`${API_BASE}/api/investigations`, {
        method: "POST",
        // Carries the session cookie; the endpoint is authenticated.
        credentials: "include",
      });
      if (!response.ok) throw new Error(`server responded ${response.status}`);
      runId = (await response.json()).runId;
    } catch (error) {
      setState((s) => ({
        ...s,
        status: "failed",
        error: `Unable to reach the investigation engine at ${API_BASE}. ${
          error instanceof Error ? error.message : ""
        }`,
      }));
      return;
    }

    // EventSource omits cookies cross-origin unless asked, and the stream is
    // behind the same auth as everything else.
    const source = new EventSource(`${API_BASE}/api/investigations/${runId}/events`, {
      withCredentials: true,
    });
    sourceRef.current = source;

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as TimedEvent;
      setState((s) => reduce(s, event));
    };
    source.addEventListener("done", () => stop());
    source.onerror = () => {
      // EventSource reconnects on its own; only surface a hard failure.
      if (source.readyState === EventSource.CLOSED) {
        setState((s) =>
          s.status === "resolved"
            ? s
            : { ...s, status: "failed", error: "Connection to the investigation engine was lost." },
        );
      }
    };
  }, [stop]);

  return { state, start };
}
