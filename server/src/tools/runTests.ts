import { z } from "zod";
import { runTests as execTests, typecheck } from "../sandbox.js";
import { defineTool } from "./types.js";

const schema = z.object({
  // Accepted for interface compatibility and ignored: the suite that runs is a
  // fixed argument vector against the sandbox, never a model-supplied path.
  projectPath: z
    .string()
    .optional()
    .describe("Ignored. The test suite always runs against the payments-api working copy."),
});

export const runTestsTool = defineTool({
  name: "run_tests",
  description:
    "Type-check and run the payments-api test suite against your current working copy. " +
    "Returns the pass/fail counts and the failure output for any failing test. " +
    "Note that the suite already contains a regression test for this incident which fails " +
    "before the defect is fixed — a run where every test passes is the signal that the fix is correct.",
  schema,
  async run(_input, ctx) {
    const types = await typecheck(ctx.sandboxRoot);
    ctx.emit({
      type: "verification",
      check: "TypeScript compilation",
      ok: types.ok,
      detail: types.ok ? "no type errors" : (types.stdout || types.stderr).slice(0, 600),
    });

    if (!types.ok) {
      return {
        content: `TypeScript compilation FAILED. Fix the type errors before running the suite.\n\n${(
          types.stdout || types.stderr
        ).slice(0, 3000)}`,
        summary: "typecheck failed",
      };
    }

    const report = await execTests(ctx.sandboxRoot);
    ctx.findings.tests = report;
    ctx.emit({
      type: "test",
      passed: report.passed,
      failed: report.failed,
      total: report.total,
      failures: report.failures.map((f) => f.split("\n")[0]),
    });
    ctx.emit({
      type: "verification",
      check: "Unit and regression tests",
      ok: report.failed === 0,
      detail: `${report.passed}/${report.total} passed`,
    });

    const lines = [
      `TypeScript compilation: OK`,
      `Tests: ${report.passed} passed, ${report.failed} failed, ${report.total} total`,
    ];
    if (report.failures.length) {
      lines.push("", "Failures:", ...report.failures.map((f) => `\n${f}`));
    }

    return {
      content: lines.join("\n"),
      summary: `${report.passed}/${report.total} tests passed`,
    };
  },
});
