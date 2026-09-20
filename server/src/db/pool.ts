import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { DATABASE_URL, PERSISTENCE_ENABLED } from "../config.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Postgres is an enhancement, never a dependency of the demo.
 *
 * An investigation that cannot be recorded is still a perfectly good
 * investigation, so every failure in this module degrades to "persistence
 * off" rather than propagating. The server says so once at boot and then
 * stops talking about it.
 */
let pool: pg.Pool | null = null;
let ready = false;

export function isPersistenceReady(): boolean {
  return ready;
}

export function getPool(): pg.Pool | null {
  return ready ? pool : null;
}

/**
 * Connects and applies the schema. Safe to call once at boot; returns whether
 * persistence came up, so the caller can report it rather than guess.
 */
export async function initPersistence(): Promise<{ ok: boolean; detail: string }> {
  if (!PERSISTENCE_ENABLED) {
    return { ok: false, detail: "disabled (PERSIST=0)" };
  }

  try {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      // A demo should find out the database is missing immediately, not after
      // the default 30s of a connection attempt nobody is watching.
      connectionTimeoutMillis: 3_000,
      max: 4,
    });

    // An idle client erroring out must not take the process down with it.
    pool.on("error", () => undefined);

    const schema = readFileSync(join(HERE, "schema.sql"), "utf8");
    await pool.query(schema);

    ready = true;
    return { ok: true, detail: redact(DATABASE_URL) };
  } catch (error) {
    ready = false;
    await pool?.end().catch(() => undefined);
    pool = null;
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function closePersistence(): Promise<void> {
  ready = false;
  await pool?.end().catch(() => undefined);
  pool = null;
}

/** Strips the password so a connection string can be logged. */
export function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}
