/**
 * Headless investigation, for iterating on the agent without the dashboard.
 *
 *   pnpm investigate
 *
 * Prints the event stream as it arrives and exits non-zero if the run did not
 * reach a verified fix.
 */
import { startRun } from "./runner.js";
import type { TimedEvent } from "./events.js";

const isAttack = process.argv.includes("--attack");

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const clock = (ms: number) => `${DIM}${(ms / 1000).toFixed(1).padStart(5)}s${RESET}`;

function render(event: TimedEvent): string {
  switch (event.type) {
    case "started":
      return `${BOLD}${event.message}${RESET}`;
    case "phase":
      return `\n${BOLD}${CYAN}── ${event.label.toUpperCase()} ──${RESET}`;
    case "narration":
      return `${DIM}${event.text}${RESET}`;
    case "thinking":
      return `${DIM}  ${event.text.split("\n").join("\n  ")}${RESET}`;
    case "tool_call":
      return `${YELLOW}→ ${event.tool}${RESET} ${DIM}${JSON.stringify(event.input).slice(0, 140)}${RESET}`;
    case "tool_result":
      return `  ${event.ok ? "" : RED}${event.summary}${RESET}`;
    case "hypothesis":
      return `${BOLD}  ? ${event.hypothesis}${RESET} ${DIM}(${event.confidence}%)${RESET}`;
    case "evidence":
      return `  ${event.supports ? GREEN + "✓" : RED + "✗"}${RESET} ${event.hypothesisId}: ${event.evidence} ${DIM}[${event.source}]${RESET}`;
    case "root_cause":
      return `\n${BOLD}${GREEN}ROOT CAUSE (${event.confidence}%)${RESET}\n${event.explanation}`;
    case "patch":
      return `\n${BOLD}PATCH ${event.path}${RESET}\n${event.diff}`;
    case "test":
      return `  ${event.failed === 0 ? GREEN : RED}${event.passed}/${event.total} tests passed${RESET}${
        event.failures.length ? `\n    ${event.failures.join("\n    ")}` : ""
      }`;
    case "verification":
      return `  ${event.ok ? GREEN + "✓" : RED + "✗"}${RESET} ${event.check} ${DIM}${event.detail}${RESET}`;
    case "memory":
      return `  ${GREEN}✓${RESET} memory ${event.beforeMB} MB → ${event.afterMB} MB ${DIM}(${event.reductionPercent}% less, ${event.beforePerTxn} → ${event.afterPerTxn} B/txn)${RESET}`;
    case "attack_assessment":
      return `\n${BOLD}ASSESSMENT [${event.priority}]${RESET} ${DIM}${event.confidence}%${RESET} — ${event.rationale}`;
    case "code_location":
      return `\n${BOLD}CODE${RESET} ${event.path}:${event.line} ${event.symbol} ${DIM}— ${event.explanation}${RESET}`;
    case "attack_sim":
      return `  ${GREEN}✓${RESET} attack replay ${event.before.sessionsCreated} → ${event.after.sessionsCreated} sessions, ${event.before.credentialsMatched} → ${event.after.credentialsMatched} matched ${DIM}(${event.after.lockedAccounts} accounts locked)${RESET}`;
    case "report":
      return `\n${BOLD}${isAttack ? "SECURITY REPORT" : "INCIDENT REPORT"}${RESET}\n${event.markdown}`;
    case "demo_mode":
      return `\n${YELLOW}${BOLD}DEMO MODE${RESET} ${event.reason}`;
    case "error":
      return `${RED}${event.fatal ? "FATAL " : ""}${event.message}${RESET}`;
    case "resolved":
      return `\n${BOLD}${GREEN}RESOLVED${RESET} ${DIM}in ${(event.durationMs / 1000).toFixed(1)}s${RESET}`;
    default:
      return JSON.stringify(event);
  }
}

const run = startRun(isAttack ? "attack" : "incident");
let resolved = false;
let fatal = false;

run.stream.subscribe((event) => {
  if (event.type === "resolved") resolved = true;
  if (event.type === "error" && event.fatal) fatal = true;
  console.log(`${clock(event.at)} ${render(event)}`);
});

await run.finished;

console.log(
  `\n${resolved && !fatal ? GREEN + "PASS" : RED + "FAIL"}${RESET} — mode: ${run.mode}, duration: ${(
    run.stream.elapsedMs / 1000
  ).toFixed(1)}s`,
);
process.exit(resolved && !fatal ? 0 : 1);
