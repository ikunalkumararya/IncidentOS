import { z } from "zod";
import { defineTool, ToolError } from "./types.js";

/**
 * These three tools do no work: they exist so that the investigation's
 * structured findings arrive as typed events while the model is still
 * reasoning, instead of having to be parsed out of its final prose.
 *
 * They are also where the investigation's ordering rules are enforced. The
 * system prompt asks for evidence before conclusions; these guards make it so
 * the model cannot skip a step even if it wants to, and it gets a specific
 * error back explaining what is missing rather than silently producing a
 * timeline with holes in it.
 */

const MIN_HYPOTHESES = 2;

export const reportHypothesis = defineTool({
  name: "report_hypothesis",
  description:
    "Record one candidate root cause. Call this once per hypothesis, before gathering evidence for any of " +
    "them. You must record at least two competing hypotheses — a single hypothesis is an assumption, not " +
    "an investigation. Include plausible alternatives you expect to disprove.",
  schema: z.object({
    id: z
      .string()
      .describe("Short stable identifier, lowercase with hyphens, e.g. memory-leak or traffic-spike."),
    hypothesis: z.string().describe("One line naming the candidate cause."),
    confidence: z
      .number()
      .min(0)
      .max(100)
      .describe("Your confidence right now, 0-100, before you have gathered evidence."),
    rationale: z.string().describe("One or two sentences on what makes this plausible."),
  }),
  run(input, ctx) {
    if (ctx.findings.hypotheses.some((h) => h.id === input.id)) {
      throw new ToolError(`hypothesis "${input.id}" has already been recorded; use a different id`);
    }
    ctx.findings.hypotheses.push(input);
    ctx.emit({ type: "hypothesis", ...input });
    return {
      content: `Recorded hypothesis "${input.id}" at ${input.confidence}% confidence.`,
      summary: `hypothesis: ${input.hypothesis} (${input.confidence}%)`,
    };
  },
});

export const reportEvidence = defineTool({
  name: "report_evidence",
  description:
    "Record one piece of evidence for or against a hypothesis. Set `supports` to false for evidence that " +
    "weakens it — disconfirming evidence is what lets you eliminate an alternative, so record it explicitly " +
    "rather than staying silent about hypotheses you have ruled out. Every claim must cite the tool result " +
    "it came from.",
  schema: z.object({
    hypothesisId: z.string().describe("The id of a hypothesis already recorded with report_hypothesis."),
    evidence: z.string().describe("One line stating the observation, with the concrete numbers or timestamps."),
    supports: z.boolean().describe("true if this supports the hypothesis, false if it weakens it."),
    source: z
      .string()
      .describe("Where it came from, e.g. 'get_metrics(memory)' or 'search_logs OOM' or 'src/transactions.ts:28'."),
  }),
  run(input, ctx) {
    const hypothesis = ctx.findings.hypotheses.find((h) => h.id === input.hypothesisId);
    if (!hypothesis) {
      const known = ctx.findings.hypotheses.map((h) => h.id).join(", ") || "none yet";
      throw new ToolError(
        `no hypothesis with id "${input.hypothesisId}". Recorded hypotheses: ${known}. ` +
          `Call report_hypothesis first.`,
      );
    }
    ctx.findings.evidence.push(input);
    ctx.emit({ type: "evidence", ...input });
    return {
      content: `Recorded ${input.supports ? "supporting" : "contradicting"} evidence for "${input.hypothesisId}".`,
      summary: `${input.supports ? "✓" : "✗"} ${input.hypothesisId}: ${input.evidence}`,
    };
  },
});

export const reportRootCause = defineTool({
  name: "report_root_cause",
  description:
    "Declare the root cause, once the evidence supports one hypothesis and weakens the others. " +
    "Explain the causal chain from the trigger through to the symptoms on the incident card.",
  schema: z.object({
    hypothesisId: z.string().describe("The id of the hypothesis the evidence confirmed."),
    explanation: z
      .string()
      .describe("A short paragraph: what changed, what it caused, and how that produced the observed symptoms."),
    confidence: z.number().min(0).max(100).describe("Your confidence in this conclusion, 0-100."),
  }),
  run(input, ctx) {
    const { hypotheses, evidence } = ctx.findings;

    if (hypotheses.length < MIN_HYPOTHESES) {
      throw new ToolError(
        `only ${hypotheses.length} hypothesis recorded. Record at least ${MIN_HYPOTHESES} competing ` +
          `hypotheses with report_hypothesis before concluding.`,
      );
    }
    if (!hypotheses.some((h) => h.id === input.hypothesisId)) {
      throw new ToolError(`no hypothesis with id "${input.hypothesisId}"`);
    }

    const supporting = evidence.filter((e) => e.hypothesisId === input.hypothesisId && e.supports);
    if (supporting.length < 2) {
      throw new ToolError(
        `"${input.hypothesisId}" has only ${supporting.length} piece(s) of supporting evidence. ` +
          `Gather more with report_evidence before declaring a root cause.`,
      );
    }

    // An investigation that never ruled anything out has not discriminated
    // between its hypotheses — it has just elaborated its first guess.
    const examined = new Set(evidence.map((e) => e.hypothesisId));
    const unexamined = hypotheses.filter((h) => !examined.has(h.id));
    if (unexamined.length) {
      throw new ToolError(
        `these hypotheses have no evidence recorded either way: ${unexamined.map((h) => h.id).join(", ")}. ` +
          `Test them and record what you find — including evidence that rules them out — before concluding.`,
      );
    }

    ctx.findings.rootCause = input;
    ctx.emit({ type: "root_cause", ...input });
    return {
      content:
        `Root cause recorded at ${input.confidence}% confidence. ` +
        `Now locate the defect in the source and fix it with apply_patch.`,
      summary: `root cause: ${input.hypothesisId} (${input.confidence}%)`,
    };
  },
});
