import type { z } from "zod";
import type { Emit } from "../events.js";
import type { MemoryMeasurement, TestReport } from "../sandbox.js";

export interface Hypothesis {
  id: string;
  hypothesis: string;
  confidence: number;
  rationale: string;
}

export interface EvidenceItem {
  hypothesisId: string;
  evidence: string;
  supports: boolean;
  source: string;
}

export interface AppliedPatch {
  path: string;
  diff: string;
  rationale: string;
}

/**
 * Everything the agent has established so far. Tools read it to enforce the
 * investigation's ordering rules and the server reads it to build the report.
 */
export interface Findings {
  hypotheses: Hypothesis[];
  evidence: EvidenceItem[];
  rootCause: { explanation: string; confidence: number; hypothesisId: string } | null;
  patches: AppliedPatch[];
  tests: TestReport | null;
  memoryBefore: MemoryMeasurement | null;
  memoryAfter: MemoryMeasurement | null;
}

export interface ToolContext {
  emit: Emit;
  findings: Findings;
}

/** What a tool hands back to the model, plus a one-liner for the UI timeline. */
export interface ToolOutcome {
  /** Returned to the model as the tool result. */
  content: string;
  /** Shown in the investigation timeline. */
  summary: string;
}

export interface ToolDefinition<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: Schema;
  run(input: z.infer<Schema>, ctx: ToolContext): Promise<ToolOutcome> | ToolOutcome;
}

export function defineTool<Schema extends z.ZodType>(tool: ToolDefinition<Schema>): ToolDefinition<z.ZodType> {
  return tool as unknown as ToolDefinition<z.ZodType>;
}

/** Raised by a tool to return an error result to the model without aborting. */
export class ToolError extends Error {}

export function emptyFindings(): Findings {
  return {
    hypotheses: [],
    evidence: [],
    rootCause: null,
    patches: [],
    tests: null,
    memoryBefore: null,
    memoryAfter: null,
  };
}
