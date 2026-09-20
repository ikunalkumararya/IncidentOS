/**
 * Promotes a recorded run to the demo fallback.
 *
 *   pnpm demo:promote            # promote the most recent run
 *   pnpm demo:promote run-…json  # promote a specific one
 *
 * Every live run is written to recordings/. Once you get one you are happy
 * with, promote it: that file becomes the stream the server replays whenever
 * the live agent is unavailable or runs over its time budget.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "recordings");
const FALLBACK = join(DIR, "fallback.json");

mkdirSync(DIR, { recursive: true });

const requested = process.argv[2];
let source: string;

if (requested) {
  // Only ever resolve a bare filename inside recordings/.
  source = join(DIR, basename(requested));
  if (!existsSync(source)) {
    console.error(`No such recording: ${basename(requested)}`);
    process.exit(1);
  }
} else {
  const candidates = readdirSync(DIR)
    .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
    .map((f) => ({ f, mtime: statSync(join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!candidates.length) {
    console.error("No recordings yet. Run `pnpm investigate` with an API key first.");
    process.exit(1);
  }
  source = join(DIR, candidates[0].f);
}

const { events } = JSON.parse(readFileSync(source, "utf8")) as { events: { type: string }[] };

// A recording that never reached a verified fix is worse than no fallback at
// all: it would put a half-finished investigation on screen during the demo.
const resolved = events.some((e) => e.type === "resolved");
const hasRootCause = events.some((e) => e.type === "root_cause");
const hasPatch = events.some((e) => e.type === "patch");

if (!resolved || !hasRootCause || !hasPatch) {
  console.error(`Refusing to promote ${basename(source)} — it is not a complete investigation:`);
  console.error(`  root cause : ${hasRootCause ? "yes" : "MISSING"}`);
  console.error(`  patch      : ${hasPatch ? "yes" : "MISSING"}`);
  console.error(`  resolved   : ${resolved ? "yes" : "MISSING"}`);
  process.exit(1);
}

copyFileSync(source, FALLBACK);

const duration = (events as { at?: number }[]).at(-1)?.at ?? 0;
console.log(`Promoted ${basename(source)} → recordings/fallback.json`);
console.log(`  ${events.length} events, ${(duration / 1000).toFixed(1)}s of investigation`);
