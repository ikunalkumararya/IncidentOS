/**
 * Pre-demo preflight. Checks everything the demo depends on *except* the live
 * API call, so you can run it five minutes before presenting and know whether
 * the machine in front of you is going to behave.
 *
 *   pnpm verify
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let failures = 0;
let warnings = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ${GREEN}✓${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
  else {
    failures++;
    console.log(`  ${RED}✗${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
  }
}

function warn(label: string, detail = "") {
  warnings++;
  console.log(`  ${YELLOW}!${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
}

console.log("\nIncidentOS preflight\n");

// -- fixtures ---------------------------------------------------------------
console.log("Demo data");
const required = [
  "logs/payments-api.log",
  "logs/payments-errors.log",
  "metrics/memory.json",
  "metrics/cpu.json",
  "metrics/requests.json",
  "metrics/errors.json",
  "kubernetes/events.json",
  "kubernetes/pods.json",
  "kubernetes/deployments.json",
  "deployments/history.json",
  "incidents/INC-4821.json",
  "security/auth-attempts.json",
  "security/campaign.json",
  "security/events.json",
  "security/sources.json",
];
for (const file of required) {
  check(file, existsSync(join(ROOT, "demo-data", file)));
}

// The fixture generator asserts the §16 timeline; re-running it here means a
// hand-edit to demo-data that broke the story is caught before the demo.
try {
  // The .bin entry is a shell shim, so it is executed directly rather than
  // handed to node.
  await run(join(ROOT, "node_modules", ".bin", "tsx"), [join(ROOT, "scripts", "generate-demo-data.ts")], {
    cwd: ROOT,
  });
  check("fixtures regenerate and match the incident timeline", true);
} catch {
  check("fixtures regenerate and match the incident timeline", false, "run `pnpm generate:demo-data` to see why");
}

// -- demo repository --------------------------------------------------------
console.log("\nDemo repository");
const transactions = join(ROOT, "demo-data", "repository", "payments-api", "src", "transactions.ts");
check("payments-api/src/transactions.ts exists", existsSync(transactions));

if (existsSync(transactions)) {
  const source = readFileSync(transactions, "utf8");
  const buggy = source.includes("const transactionCache: PaymentRequest[] = []");
  check(
    "the defect is present (retains PaymentRequest, not TransactionSummary)",
    buggy,
    buggy ? "" : "the repository looks already fixed — restore it from git",
  );
}

const auth = join(ROOT, "demo-data", "repository", "payments-api", "src", "auth.ts");
check("payments-api/src/auth.ts exists", existsSync(auth));

if (existsSync(auth)) {
  const source = readFileSync(auth, "utf8");
  const hasIpThrottleState = source.includes("ipAttempts");
  const looksFixed = /lock/i.test(source);
  check("the auth defect scaffolding is present (ipAttempts)", hasIpThrottleState);
  check(
    "the auth defect is present (no per-account lockout)",
    !looksFixed,
    looksFixed ? "the auth defect looks already fixed — restore it from git" : "",
  );
}

const authLockoutTest = join(ROOT, "demo-data", "repository", "payments-api", "tests", "auth-lockout.test.ts");
check("payments-api/tests/auth-lockout.test.ts exists", existsSync(authLockoutTest));

const attackSim = join(ROOT, "demo-data", "repository", "payments-api", "scripts", "attack-sim.ts");
check("payments-api/scripts/attack-sim.ts exists", existsSync(attackSim));

// -- toolchain --------------------------------------------------------------
console.log("\nToolchain");
for (const bin of ["vitest", "tsc", "tsx"]) {
  check(`node_modules/.bin/${bin}`, existsSync(join(ROOT, "node_modules", ".bin", bin)));
}

// -- environment ------------------------------------------------------------
console.log("\nEnvironment");
const envPath = join(ROOT, ".env");
const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const hasKey = /^ANTHROPIC_API_KEY=.+/m.test(env) || Boolean(process.env.ANTHROPIC_API_KEY);

if (hasKey) check("ANTHROPIC_API_KEY is configured", true);
else warn("ANTHROPIC_API_KEY is not set", "the live demo will fall back to the recording");

const fallback = join(ROOT, "recordings", "fallback.json");
if (existsSync(fallback)) {
  const { events } = JSON.parse(readFileSync(fallback, "utf8")) as { events: { type: string }[] };
  check("fallback recording available", true, `${events.length} events`);
} else if (hasKey) {
  warn("no fallback recording", "run `pnpm investigate` then `pnpm demo:promote` before the demo");
} else {
  check("fallback recording available", false, "and no API key — the demo cannot run");
}

// -- summary ----------------------------------------------------------------
console.log("");
if (failures) {
  console.log(`${RED}${failures} check(s) failed${RESET}${warnings ? `, ${warnings} warning(s)` : ""}\n`);
  process.exit(1);
}
console.log(`${GREEN}Ready${RESET}${warnings ? ` — with ${warnings} warning(s)` : ""}\n`);
