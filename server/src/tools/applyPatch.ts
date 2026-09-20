import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { z } from "zod";
import { SANDBOX_REPO } from "../config.js";
import { resolveInSandbox } from "../sandbox.js";
import { defineTool, ToolError } from "./types.js";

/**
 * Builds a unified diff for an exact-string replacement.
 *
 * Because the edit is a contiguous substring swap we know precisely which
 * lines changed, so there is no need to run a diff algorithm — and no risk of
 * the rendered diff disagreeing with what was actually written.
 */
function unifiedDiff(path: string, before: string, after: string, offset: number, findLength: number): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  const startLine = before.slice(0, offset).split("\n").length - 1;
  const endLineBefore = before.slice(0, offset + findLength).split("\n").length - 1;
  const removed = endLineBefore - startLine + 1;
  const added = removed + (afterLines.length - beforeLines.length);

  const CONTEXT = 3;
  const from = Math.max(0, startLine - CONTEXT);
  const toBefore = Math.min(beforeLines.length, endLineBefore + 1 + CONTEXT);

  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${from + 1},${toBefore - from} +${from + 1},${toBefore - from - removed + added} @@`,
  ];

  for (let i = from; i < startLine; i++) lines.push(` ${beforeLines[i]}`);
  for (let i = startLine; i <= endLineBefore; i++) lines.push(`-${beforeLines[i]}`);
  for (let i = startLine; i < startLine + added; i++) lines.push(`+${afterLines[i]}`);
  for (let i = endLineBefore + 1; i < toBefore; i++) lines.push(` ${beforeLines[i]}`);

  return lines.join("\n");
}

const schema = z.object({
  path: z.string().describe("File to patch, relative to the repository root, e.g. src/transactions.ts."),
  find: z
    .string()
    .describe(
      "The exact text to replace, copied verbatim from read_file including indentation. " +
        "Must appear exactly once in the file.",
    ),
  replace: z.string().describe("The replacement text."),
  rationale: z.string().describe("One sentence: why this change fixes the root cause."),
});

export const applyPatch = defineTool({
  name: "apply_patch",
  description:
    "Apply a minimal edit to a file in the payments-api repository by replacing an exact block of text. " +
    "`find` must match the file byte for byte (copy it out of read_file, without the line-number gutter) " +
    "and must be unique in the file. Prefer the smallest edit that fixes the defect. " +
    "You may call this more than once if a fix spans several places.",
  schema,
  async run(input, ctx) {
    if (!ctx.findings.rootCause) {
      throw new ToolError(
        "You have not established a root cause yet. Call report_root_cause first — a patch that is not " +
          "tied to a proven cause is a guess.",
      );
    }

    const target = resolveInSandbox(input.path);
    const rel = relative(SANDBOX_REPO, target);
    const before = await readFile(target, "utf8");

    const first = before.indexOf(input.find);
    if (first === -1) {
      throw new ToolError(
        `the \`find\` text does not appear in ${rel}. Re-read the file and copy the exact text, ` +
          `including leading whitespace and without the line-number gutter.`,
      );
    }
    if (before.indexOf(input.find, first + 1) !== -1) {
      throw new ToolError(
        `the \`find\` text appears more than once in ${rel}; include more surrounding context to make it unique.`,
      );
    }

    const after = before.slice(0, first) + input.replace + before.slice(first + input.find.length);
    if (after === before) {
      throw new ToolError("the replacement is identical to the original — nothing would change.");
    }

    await writeFile(target, after, "utf8");

    const diff = unifiedDiff(rel, before, after, first, input.find.length);
    ctx.findings.patches.push({ path: rel, diff, rationale: input.rationale });
    ctx.emit({ type: "patch", path: rel, diff, rationale: input.rationale });

    return {
      content: `Patch applied to ${rel}.\n\n${diff}\n\nRun run_tests to verify it.`,
      summary: `patched ${rel}`,
    };
  },
});
