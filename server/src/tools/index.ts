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
import { getAttackSources } from "./security/getAttackSources.js";
import { getAuthAttempts } from "./security/getAuthAttempts.js";
import { getSecurityEvents } from "./security/getSecurityEvents.js";
import { reportAttackAssessment } from "./security/reportAttackAssessment.js";
import { reportCodeLocation } from "./security/reportCodeLocation.js";
import type { ToolContext, ToolDefinition } from "./types.js";
import { ToolError } from "./types.js";

/**
 * Each registry's tool list is identical on every turn of every phase for its
 * kind of run. Keeping it stable keeps the cached prompt prefix valid across
 * phases — the tools block renders before the system prompt and the messages,
 * so changing it mid-run would invalidate everything after it.
 *
 * Phase ordering is instead enforced by the guards inside the report_* and
 * apply_patch tools, which also gives the model a specific, actionable error
 * when it tries to skip a step.
 */
export const INCIDENT_TOOLS: ToolDefinition[] = [
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

export const ATTACK_TOOLS: ToolDefinition[] = [
  getAuthAttempts,
  getAttackSources,
  getSecurityEvents,
  getMetrics,
  searchLogs,
  getKubernetesEvents,
  getDeploymentHistory,
  searchCode,
  readFileTool,
  reportHypothesis,
  reportEvidence,
  reportRootCause,
  reportAttackAssessment,
  reportCodeLocation,
  applyPatch,
  runTestsTool,
];

export interface ToolExecution {
  ok: boolean;
  content: string;
  summary: string;
}

export interface ToolRegistry {
  /** Tool definitions in the shape the Messages API expects, computed once. */
  specs: Anthropic.Tool[];
  execute(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolExecution>;
}

/**
 * Builds a registry for one fixed tool list.
 *
 * Nothing `execute` does throws: a bad argument, an unknown tool or a failing
 * tool all come back as an error result the model can read and react to. Per
 * spec §20 the agent must never be handed a fabricated result, so a failure is
 * reported as a failure and the run continues with the evidence that is
 * available.
 */
export function createToolRegistry(tools: readonly ToolDefinition[]): ToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const specs: Anthropic.Tool[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: z.toJSONSchema(tool.schema, { io: "input" }) as Anthropic.Tool.InputSchema,
  }));

  async function execute(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolExecution> {
    const tool = byName.get(name);
    if (!tool) {
      return {
        ok: false,
        content: `Unknown tool "${name}". Available tools: ${[...byName.keys()].join(", ")}.`,
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

  return { specs, execute };
}

export const INCIDENT_REGISTRY = createToolRegistry(INCIDENT_TOOLS);
export const ATTACK_REGISTRY = createToolRegistry(ATTACK_TOOLS);

// Compatibility aliases over the incident registry, the only one that existed
// before attack investigations were added.
export const TOOLS = INCIDENT_TOOLS;
export const toolSpecs = (): Anthropic.Tool[] => INCIDENT_REGISTRY.specs;
export const executeTool = INCIDENT_REGISTRY.execute;
