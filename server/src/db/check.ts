import pg from "pg";
import { DATABASE_URL, DATABASE_CONNECT_TIMEOUT_MS } from "../config.js";

// Read-only connectivity check: does not initialize tables or seed accounts.
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
  max: 1,
});
pool.on("error", () => undefined);
try {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    // Inspect the client connection: pg_stat_ssl describes the pooler's
    // upstream connection, not TLS between this app and Neon's proxy.
    console.log(`Database connection OK; client TLS ${client.ssl ? "enabled" : "disabled (local connections only)"}.`);
  } finally {
    client.release();
  }
} catch (error) {
  // Avoid logging connection strings or credentials from driver errors.
  const code = (error as { code?: string }).code;
  console.error(`Database connection failed${code && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : ""}. Check DATABASE_URL, network access, and SSL settings.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
