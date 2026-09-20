import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { applyPatch } from "./applyPatch.js";
import { getDeploymentHistory } from "./getDeploymentHistory.js";
import { getKubernetesEvents } from "./getKubernetesEvents.js";
import { getMetrics } from "./getMetrics.js";
import { readFileTool } from "./readFile.js";
import { reportEvidence, reportHypothesis, reportRootCause } from "./report.js";
import { runTestsTool } from "./runTests.js";
import { searchCode } from "./searchCode.js";
import { searchLogs } from "./searchLogs.js";
import type { ToolContext, ToolDefinition } from "./types.js";
import { ToolError } from "./types.js";

/**
 * The tool list is identical on every turn of every phase. Keeping it stable
 * keeps the cached prompt prefix valid across phases — the tools block renders
 * before the system prompt and the messages, so changing it mid-run would
 * invalidate everything after it.
 *
 * Phase ordering is enforced by the guards inside the report_* and apply_patch
 * tools instead, which also gives the model a specific, actionable error when
 * it tries to skip a step.
 */
export const TOOLS: ToolDefinition[] = [
  searchLogs,
  getMetrics,
  getKubernetesEvents,
  getDeploymentHistory,
  searchCode,
  readFileTool,
  reportHypothesis,
  reportEvidence,
  reportRootCause,
  applyPatch,
  runTestsTool,
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Tool definitions in the shape the Messages API expects. */
export function toolSpecs(): Anthropic.Tool[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.schema, { io: "input" }) as Anthropic.Tool.InputSchema,
  }));
}

export interface ToolExecution {
  ok: boolean;
  content: string;
  summary: string;
}

/**
 * Validates and runs one tool call.
 *
 * Nothing here throws: a bad argument, an unknown tool or a failing tool all
 * come back as an error result the model can read and react to. Per spec §20
 * the agent must never be handed a fabricated result, so a failure is reported
 * as a failure and the run continues with the evidence that is available.
 */
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolExecution> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return {
      ok: false,
      content: `Unknown tool "${name}". Available tools: ${[...BY_NAME.keys()].join(", ")}.`,
      summary: `unknown tool ${name}`,
    };
  }

  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      content: `Invalid arguments for ${name}: ${issues}`,
      summary: `${name}: invalid arguments`,
    };
  }

  try {
    const outcome = await tool.run(parsed.data, ctx);
    return { ok: true, content: outcome.content, summary: outcome.summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A ToolError is an expected refusal (ordering rule, bad path, no match) —
    // the model is meant to read it and adjust. Anything else is a real bug in
    // a tool, reported honestly as an unavailable tool per spec §20.
    return {
      ok: false,
      content:
        error instanceof ToolError
          ? message
          : `Tool ${name} failed: ${message}. Continue with the evidence you already have.`,
      summary: `${name}: ${message.split("\n")[0].slice(0, 120)}`,
    };
  }
}
