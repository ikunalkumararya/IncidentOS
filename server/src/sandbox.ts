import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { DEMO_REPO, REPO_ROOT, sandboxRepoFor } from "./config.js";
import type { RunKind } from "./events.js";

const run = promisify(execFile);

/**
 * Both subjects' red regression tests live in the demo repository at all
 * times (there is only one generated copy of payments-api). A run's sandbox
 * must carry only its own subject's regression test, or the other subject's
 * still-failing test would block this run's green gate.
 */
const RED_TESTS_TO_STRIP: Record<RunKind, string[]> = {
  incident: ["tests/auth-lockout.test.ts"],
  attack: ["tests/memory-regression.test.ts"],
};

/**
 * Resets the agent's working copy for one run kind to a pristine checkout of
 * the demo repository. Called at the start of every investigation so a run
 * never inherits a previous run's patch. Only that kind's directory is
 * touched, so a concurrent incident run and attack run never clobber each
 * other.
 */
export async function prepareSandbox(kind: RunKind): Promise<void> {
  const root = sandboxRepoFor(kind);
  await rm(root, { recursive: true, force: true });
  await mkdir(dirname(root), { recursive: true });
  await cp(DEMO_REPO, root, { recursive: true });
  await Promise.all(
    RED_TESTS_TO_STRIP[kind].map((file) => rm(join(root, file), { force: true })),
  );
}

/**
 * Resolves a model-supplied path inside the given sandbox root, rejecting
 * anything that escapes it.
 *
 * The path is untrusted model output, so `..` segments and absolute paths have
 * to be rejected after resolution, not by inspecting the string. Paths are
 * also accepted with a leading `payments-api/` or `src/...` so the model does
 * not have to guess the sandbox layout.
 */
export function resolveInSandbox(candidate: string, root: string): string {
  const cleaned = candidate.replace(/^\.?\//, "").replace(/^payments-api\//, "");
  const target = resolve(root, cleaned);
  const rel = relative(root, target);

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

/** Runs the demo repository's vitest suite against the given sandbox root. */
export async function runTests(root: string): Promise<TestReport> {
  const reportPath = join(dirname(root), "vitest-report.json");
  await rm(reportPath, { force: true });

  const result = await runFixed(
    bin("vitest"),
    ["run", "--root", root, "--reporter=json", `--outputFile=${reportPath}`],
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

/** Type-checks the sandbox at the given root. */
export async function typecheck(root: string): Promise<CommandResult> {
  return runFixed(bin("tsc"), ["--noEmit", "-p", join(root, "tsconfig.json")], REPO_ROOT);
}

export interface MemoryMeasurement {
  transactions: number;
  queueDepth: number;
  retainedMB: number;
  bytesPerTransaction: number;
}

/**
 * Runs the demo repository's memory simulation against whatever is currently
 * in the sandbox at `root`. These are real measurements of real code, taken
 * once before the patch and once after.
 */
export async function measureMemory(root: string): Promise<MemoryMeasurement> {
  const result = await runFixed(
    process.execPath,
    ["--expose-gc", "--import", "tsx", join("scripts", "memory-sim.ts")],
    root,
  );

  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line) {
    throw new Error(`memory simulation produced no output: ${result.stderr.slice(-500)}`);
  }
  return JSON.parse(line) as MemoryMeasurement;
}

export interface AttackSimResult {
  attempts: number;
  sources: number;
  rateLimited: number;
  attemptsReachingVerifier: number;
  credentialsMatched: number;
  sessionsCreated: number;
  lockedAccounts: number;
}

/**
 * Runs the demo repository's attack simulation (mirrors measureMemory): it
 * replays the campaign's fixture source distribution against whatever is
 * currently in the sandbox at `root`, once before the patch and once after.
 */
export async function measureAttack(root: string): Promise<AttackSimResult> {
  const result = await runFixed(
    process.execPath,
    ["--import", "tsx", join("scripts", "attack-sim.ts")],
    root,
  );

  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line) {
    throw new Error(`attack simulation produced no output: ${result.stderr.slice(-500)}`);
  }
  return JSON.parse(line) as AttackSimResult;
}
