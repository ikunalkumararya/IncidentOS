import { config as loadEnv } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunKind } from "./events.js";

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

/** One sandbox per run kind, so a live incident run and a live attack run never share a working copy. */
export const sandboxRepoFor = (kind: RunKind) => join(SANDBOX_ROOT, kind, "payments-api");

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

/**
 * Wall-clock cap for one attack investigation. Longer than the incident's
 * because the fix phase runs a patch, a type-check, the test suite and two
 * attack-replay simulations (baseline and post-patch) rather than one memory
 * measurement.
 */
export const ATTACK_TIMEOUT_MS = Number(process.env.ATTACK_TIMEOUT_MS ?? 180_000);

/** Force the recorded stream instead of calling the API. */
export const FORCE_DEMO_MODE = process.env.DEMO_MODE === "1";

/** Hard cap on agent turns per phase, so a confused model cannot loop forever. */
export const MAX_ITERATIONS_PER_PHASE = 14;

export const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://incidentos:incidentos@localhost:5432/incidentos";

/** Allow time for a suspended cloud database to wake up. */
export const DATABASE_CONNECT_TIMEOUT_MS = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 15_000);
if (!Number.isInteger(DATABASE_CONNECT_TIMEOUT_MS) || DATABASE_CONNECT_TIMEOUT_MS <= 0) {
  throw new Error("DATABASE_CONNECT_TIMEOUT_MS must be a positive integer");
}

export const SEED_DEMO_USER = process.env.SEED_DEMO_USER !== "0";

/**
 * Persistence is an enhancement, not a dependency: the demo runs and streams
 * identically with the database down. Set to 0 to skip connecting entirely.
 */
export const PERSISTENCE_ENABLED = process.env.PERSIST !== "0";

/**
 * Signing key for session tokens.
 *
 * The fallback exists so the demo runs out of the box, and is treated as
 * untrusted: the server warns loudly at boot when it is in use, because a
 * published default key means anyone can mint a valid session.
 */
export const JWT_SECRET = process.env.JWT_SECRET || "incidentos-insecure-development-secret";
export const JWT_SECRET_IS_DEFAULT = !process.env.JWT_SECRET;

/** Session lifetime. Short enough to be a demo, long enough to survive one. */
export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 12);

export const SESSION_COOKIE = "incidentos_session";

/** Origin allowed to send credentialed requests. */
export const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";

/**
 * Seeded so the demo is usable the moment the database is up, without anyone
 * having to register first.
 */
export const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL || "demo@incidentos.dev";
export const DEMO_USER_PASSWORD = process.env.DEMO_USER_PASSWORD || "incident123";
export const DEMO_USER_NAME = process.env.DEMO_USER_NAME || "Demo Responder";
