import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { z } from "zod";
import { resolveInSandbox } from "../../sandbox.js";
import { defineTool, ToolError } from "../types.js";

const schema = z.object({
  path: z.string().describe("File containing the weakness, relative to the repository root, e.g. src/auth.ts."),
  line: z.number().int().min(1).describe("The exact line number of the weakness."),
  symbol: z.string().describe("The function, method or constant at that line, e.g. issueToken."),
  explanation: z.string().describe("One or two sentences on why this line is the weakness."),
});

export const reportCodeLocation = defineTool({
  name: "report_code_location",
  description:
    "Name the exact file, line and symbol where the weakness lives, once you have proven the root cause. " +
    "This is required before apply_patch — a patch has to be tied to a specific, verified location, not " +
    "just a general area of the file.",
  schema,
  async run(input, ctx) {
    if (!ctx.findings.rootCause) {
      throw new ToolError(
        "You have not established a root cause yet. Call report_root_cause first — a code location that " +
          "is not tied to a proven cause is a guess.",
      );
    }

    const target = resolveInSandbox(input.path, ctx.sandboxRoot);
    const rel = relative(ctx.sandboxRoot, target);
    const text = await readFile(target, "utf8");
    const fileLines = text.split("\n");

    if (input.line > fileLines.length) {
      throw new ToolError(
        `${rel} only has ${fileLines.length} lines; line ${input.line} does not exist. Re-read the file.`,
      );
    }

    ctx.findings.codeLocation = { path: rel, line: input.line, symbol: input.symbol, explanation: input.explanation };
    ctx.emit({ type: "code_location", path: rel, line: input.line, symbol: input.symbol, explanation: input.explanation });

    const from = Math.max(1, input.line - 6);
    const to = Math.min(fileLines.length, input.line + 6);
    const context = [];
    for (let n = from; n <= to; n++) {
      const marker = n === input.line ? ">" : " ";
      context.push(`${marker}${String(n).padStart(4)}  ${fileLines[n - 1]}`);
    }

    return {
      content: `Recorded code location ${rel}:${input.line} (${input.symbol}).\n\n${context.join("\n")}`,
      summary: `code: ${rel}:${input.line} ${input.symbol}`,
    };
  },
});
