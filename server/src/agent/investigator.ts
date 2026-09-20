import Anthropic from "@anthropic-ai/sdk";
import { API_KEY, sandboxRepoFor } from "../config.js";
import { PHASE_LABELS, type Emit } from "../events.js";
import { loadIncident } from "../incidents/index.js";
import { measureMemory, prepareSandbox } from "../sandbox.js";
import { INCIDENT_REGISTRY } from "../tools/index.js";
import { emptyFindings, type Findings, type ToolContext } from "../tools/types.js";
import { createConversation, InvestigationAborted } from "./loop.js";
import {
  FIX_PROMPT,
  HYPOTHESIS_PROMPT,
  incidentBriefing,
  PROVE_PROMPT,
  reportPrompt,
  SYSTEM_PROMPT,
} from "./prompts.js";

export { InvestigationAborted };

/**
 * Runs one investigation end to end.
 *
 * The conversation is a single thread across all phases: the model keeps
 * everything it has learned, and the cached prefix (tools + system prompt)
 * stays valid because neither changes between phases.
 */
export async function runInvestigation(emit: Emit, signal: AbortSignal): Promise<Findings> {
  if (!API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) or run in DEMO_MODE=1.",
    );
  }

  const client = new Anthropic({ apiKey: API_KEY, maxRetries: 2 });
  const incident = loadIncident();
  const findings = emptyFindings("incident");
  const root = sandboxRepoFor("incident");
  const ctx: ToolContext = { emit, findings, sandboxRoot: root };

  emit({
    type: "started",
    incidentId: incident.id,
    message: `${incident.severity} · ${incident.title} · ${incident.service}`,
    kind: "incident",
  });

  emit({ type: "narration", text: "Checking out a working copy of payments-api…" });
  await prepareSandbox("incident");

  // Baseline memory has to be measured before the agent touches anything.
  // Kick it off now and collect it before the fix phase: it takes a few
  // seconds and there is no reason for the model to wait on it.
  const baselinePromise = measureMemory(root).catch(() => null);

  const conversation = createConversation({
    client,
    systemPrompt: SYSTEM_PROMPT,
    registry: INCIDENT_REGISTRY,
    ctx,
    emit,
    signal,
    labels: PHASE_LABELS,
  });
  const { runPhase } = conversation;

  const throwIfAborted = () => {
    if (signal.aborted) throw new InvestigationAborted("investigation aborted");
  };

  await runPhase({ phase: "investigate", prompt: incidentBriefing(incident) });
  await runPhase({ phase: "hypothesize", prompt: HYPOTHESIS_PROMPT });
  await runPhase({ phase: "prove", prompt: PROVE_PROMPT });

  findings.memoryBefore = await baselinePromise;

  await runPhase({ phase: "fix", prompt: FIX_PROMPT });

  // ---------------------------------------------------------------------
  // Server-side verification. Deliberately not the model's job: these are
  // measurements, and the demo's credibility rests on them being taken by
  // something that has no stake in the answer.
  // ---------------------------------------------------------------------
  throwIfAborted();
  emit({ type: "phase", phase: "verify", label: PHASE_LABELS.verify });

  emit({
    type: "verification",
    check: "Patch applied",
    ok: findings.patches.length > 0,
    detail: findings.patches.length
      ? findings.patches.map((p) => p.path).join(", ")
      : "no patch was applied",
  });

  if (findings.patches.length && findings.memoryBefore) {
    emit({ type: "narration", text: "Re-running the memory simulation against the patched code…" });
    const after = await measureMemory(root).catch(() => null);
    findings.memoryAfter = after;

    if (after) {
      const before = findings.memoryBefore;
      const reduction = ((before.retainedMB - after.retainedMB) / before.retainedMB) * 100;
      emit({
        type: "memory",
        beforeMB: before.retainedMB,
        afterMB: after.retainedMB,
        beforePerTxn: before.bytesPerTransaction,
        afterPerTxn: after.bytesPerTransaction,
        reductionPercent: Number(reduction.toFixed(1)),
      });
      emit({
        type: "verification",
        check: "Memory simulation",
        ok: reduction > 50,
        detail: `${before.retainedMB} MB → ${after.retainedMB} MB retained over ${before.transactions.toLocaleString()} captures (${reduction.toFixed(1)}% reduction)`,
      });
    }
  }

  const tests = findings.tests;
  const green = Boolean(tests && tests.failed === 0 && tests.total > 0);

  if (green) {
    const markdown = await runPhase({ phase: "report", prompt: reportPrompt(), textOnly: true });
    if (markdown) emit({ type: "report", markdown });
    emit({ type: "resolved", durationMs: 0 });
  } else {
    emit({
      type: "error",
      message: tests
        ? `Verification incomplete: ${tests.failed} of ${tests.total} tests still failing.`
        : "Verification incomplete: the test suite was never run.",
      fatal: false,
    });
  }

  return findings;
}
