import { config as loadEnv } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Monorepo root — two levels up from server/src. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

loadEnv({ path: join(REPO_ROOT, ".env"), quiet: true });

export const DEMO_DATA = join(REPO_ROOT, "demo-data");
export const DEMO_REPO = join(DEMO_DATA, "repository", "payments-api");

/**
 * Where the agent's working copy lives. Deliberately inside the workspace so
 * Node resolves the root node_modules when the tests and the memory
 * simulation run — a copy under /tmp has no module resolution path.
 */
export const SANDBOX_ROOT = join(REPO_ROOT, ".sandbox");
export const SANDBOX_REPO = join(SANDBOX_ROOT, "payments-api");

export const RECORDINGS_DIR = join(REPO_ROOT, "recordings");
export const FALLBACK_RECORDING = join(RECORDINGS_DIR, "fallback.json");

export const PORT = Number(process.env.PORT ?? 4000);
export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
export const API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Wall-clock cap for one investigation. A slow run is a failed demo, so when
 * this elapses the server aborts the agent and finishes from the recording.
 */
export const INVESTIGATION_TIMEOUT_MS = Number(process.env.INVESTIGATION_TIMEOUT_MS ?? 90_000);

/** Force the recorded stream instead of calling the API. */
export const FORCE_DEMO_MODE = process.env.DEMO_MODE === "1";

/** Hard cap on agent turns per phase, so a confused model cannot loop forever. */
export const MAX_ITERATIONS_PER_PHASE = 14;
