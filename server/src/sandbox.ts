import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { DEMO_REPO, REPO_ROOT, SANDBOX_REPO, SANDBOX_ROOT } from "./config.js";

const run = promisify(execFile);

/**
 * Resets the agent's working copy to a pristine checkout of the demo
 * repository. Called at the start of every investigation so a run never
 * inherits the previous run's patch.
 */
export async function prepareSandbox(): Promise<void> {
  await rm(SANDBOX_ROOT, { recursive: true, force: true });
  await mkdir(SANDBOX_ROOT, { recursive: true });
  await cp(DEMO_REPO, SANDBOX_REPO, { recursive: true });
}

/**
 * Resolves a model-supplied path inside the sandbox, rejecting anything that
 * escapes it.
 *
 * The path is untrusted model output, so `..` segments and absolute paths have
 * to be rejected after resolution, not by inspecting the string. Paths are
 * also accepted with a leading `payments-api/` or `src/...` so the model does
 * not have to guess the sandbox layout.
 */
export function resolveInSandbox(candidate: string): string {
  const cleaned = candidate.replace(/^\.?\//, "").replace(/^payments-api\//, "");
  const target = resolve(SANDBOX_REPO, cleaned);
  const rel = relative(SANDBOX_REPO, target);

  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(
      `path "${candidate}" resolves outside the demo repository; only files under payments-api/ may be read or patched`,
    );
  }
  return target;
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Runs one of a fixed set of commands against the sandbox.
 *
 * Every argument vector here is a literal defined in this file — the model
 * never supplies a command, an argument or a path. `execFile` (not `exec`)
 * means there is no shell to inject into.
 */
async function runFixed(file: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await run(file, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      // Inherit PATH but never the API key: nothing spawned here needs it.
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    });
    return { ok: true, stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    return {
      ok: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err.message ?? err),
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
}

const bin = (name: string) => join(REPO_ROOT, "node_modules", ".bin", name);

export interface TestReport {
  passed: number;
  failed: number;
  total: number;
  failures: string[];
  raw: string;
}

/** Runs the demo repository's vitest suite. Takes no caller-supplied input. */
export async function runTests(): Promise<TestReport> {
  const reportPath = join(SANDBOX_ROOT, "vitest-report.json");
  await rm(reportPath, { force: true });

  const result = await runFixed(
    bin("vitest"),
    ["run", "--root", SANDBOX_REPO, "--reporter=json", `--outputFile=${reportPath}`],
    REPO_ROOT,
  );

  let parsed: any;
  try {
    parsed = JSON.parse(await readFile(reportPath, "utf8"));
  } catch {
    return {
      passed: 0,
      failed: 0,
      total: 0,
      failures: ["vitest did not produce a report"],
      raw: (result.stderr || result.stdout).slice(-4000),
    };
  }

  const failures: string[] = [];
  for (const file of parsed.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === "failed") {
        const messages: string[] = assertion.failureMessages ?? [];
        failures.push(
          `${assertion.fullName}\n${messages.join("\n").split("\n").slice(0, 6).join("\n")}`,
        );
      }
    }
  }

  return {
    passed: parsed.numPassedTests ?? 0,
    failed: parsed.numFailedTests ?? 0,
    total: parsed.numTotalTests ?? 0,
    failures,
    raw: (result.stdout || result.stderr).slice(-4000),
  };
}

/** Type-checks the sandbox. */
export async function typecheck(): Promise<CommandResult> {
  return runFixed(bin("tsc"), ["--noEmit", "-p", join(SANDBOX_REPO, "tsconfig.json")], REPO_ROOT);
}

export interface MemoryMeasurement {
  transactions: number;
  queueDepth: number;
  retainedMB: number;
  bytesPerTransaction: number;
}

/**
 * Runs the demo repository's memory simulation against whatever is currently
 * in the sandbox. These are real measurements of real code, taken once before
 * the patch and once after.
 */
export async function measureMemory(): Promise<MemoryMeasurement> {
  const result = await runFixed(
    process.execPath,
    ["--expose-gc", "--import", "tsx", join("scripts", "memory-sim.ts")],
    SANDBOX_REPO,
  );

  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line) {
    throw new Error(`memory simulation produced no output: ${result.stderr.slice(-500)}`);
  }
  return JSON.parse(line) as MemoryMeasurement;
}
