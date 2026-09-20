import Anthropic from "@anthropic-ai/sdk";
import { API_KEY, MAX_ITERATIONS_PER_PHASE, MODEL } from "../config.js";
import { PHASE_LABELS, type Emit, type Phase } from "../events.js";
import { loadIncident } from "../incidents/index.js";
import { measureMemory, prepareSandbox } from "../sandbox.js";
import { executeTool, toolSpecs } from "../tools/index.js";
import { emptyFindings, type Findings, type ToolContext } from "../tools/types.js";
import {
  FIX_PROMPT,
  HYPOTHESIS_PROMPT,
  incidentBriefing,
  PROVE_PROMPT,
  reportPrompt,
  SYSTEM_PROMPT,
} from "./prompts.js";

export class InvestigationAborted extends Error {}

interface PhaseOptions {
  phase: Phase;
  prompt: string;
  /** Prevent tool use — used for the final written report. */
  textOnly?: boolean;
}

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
  const findings = emptyFindings();
  const ctx: ToolContext = { emit, findings };
  const messages: Anthropic.MessageParam[] = [];
  const tools = toolSpecs();

  emit({
    type: "started",
    incidentId: incident.id,
    message: `${incident.severity} · ${incident.title} · ${incident.service}`,
  });

  emit({ type: "narration", text: "Checking out a working copy of payments-api…" });
  await prepareSandbox();

  // Baseline memory has to be measured before the agent touches anything.
  // Kick it off now and collect it before the fix phase: it takes a few
  // seconds and there is no reason for the model to wait on it.
  const baselinePromise = measureMemory().catch(() => null);

  const throwIfAborted = () => {
    if (signal.aborted) throw new InvestigationAborted("investigation aborted");
  };

  async function runPhase({ phase, prompt, textOnly }: PhaseOptions): Promise<string> {
    throwIfAborted();
    emit({ type: "phase", phase, label: PHASE_LABELS[phase] });
    messages.push({ role: "user", content: prompt });

    let finalText = "";

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_PHASE; iteration++) {
      throwIfAborted();

      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 64_000,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools,
          ...(textOnly ? { tool_choice: { type: "none" as const } } : {}),
          messages,
        },
        { signal },
      );

      // Summarised reasoning is flushed a block at a time rather than per
      // delta: it keeps the console readable and the recording small, and the
      // tool calls already carry the moment-to-moment sense of progress.
      let thinkingBuffer = "";
      stream.on("thinking", (delta) => {
        thinkingBuffer += delta;
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "thinking" && thinkingBuffer.trim()) {
          emit({ type: "thinking", text: thinkingBuffer.trim() });
          thinkingBuffer = "";
        }
      });

      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        throw new Error("the model declined to continue this turn");
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }

      const toolUses = message.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      // A tool input truncated at max_tokens usually still parses into a
      // plausible-looking object, so never run the tools from such a turn.
      if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
        throw new Error("tool input was truncated at max_tokens");
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text) finalText = text;

      if (toolUses.length === 0) return finalText;

      messages.push({ role: "assistant", content: message.content });

      // Parallel tool calls must come back as tool_result blocks in a single
      // user message, or the model learns to stop issuing them in parallel.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        emit({ type: "tool_call", tool: call.name, input: call.input });
        const outcome = await executeTool(call.name, call.input, ctx);
        emit({ type: "tool_result", tool: call.name, summary: outcome.summary, ok: outcome.ok });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: outcome.content,
          ...(outcome.ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: "user", content: results });
    }

    emit({
      type: "narration",
      text: `Reached the turn limit for this phase after ${MAX_ITERATIONS_PER_PHASE} steps; moving on.`,
    });
    return finalText;
  }

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
    const after = await measureMemory().catch(() => null);
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
