import { randomUUID } from "node:crypto";
import { closePersistence, getPool, initPersistence } from "../server/src/db/pool.js";

/**
 * Puts a handful of incidents in the queue so the dashboard has something to
 * show on a fresh database.
 *
 * What it seeds is the *intake* — the report or the log batch, exactly as the
 * website form or the log collector would have delivered it. It does not write
 * phases, timings or reports: the running worker investigates these for real,
 * the same way it would any other incident. Seeding the findings instead would
 * put fabricated timings on screen next to measured ones, and there would be
 * no way to tell which was which.
 *
 *   pnpm seed:incidents          insert them (safe to re-run)
 *   pnpm seed:incidents --reset  remove them again
 *
 * The API server has to be running for the investigations to progress; with it
 * down the incidents simply sit queued until it comes back.
 */

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

interface Seed {
  /** Stable, so re-running updates nothing and creates nothing twice. */
  eventId: string;
  source: "website" | "monitoring" | "manual";
  title: string;
  service: string;
  severity: string;
  description: string;
  evidence?: { timestamp: string; level: string; message: string }[];
}

const SEEDS: Seed[] = [
  {
    eventId: "seed-payments-oom",
    source: "monitoring",
    title: "payments-api: process or memory failure",
    service: "payments-api",
    severity: "critical",
    description:
      "9/14 entries are errors (64%). 4 crash/memory signals across three pods in the last five minutes.",
    evidence: [
      { timestamp: minutesAgo(9), level: "warn", message: "container memory usage 78% of 2Gi limit" },
      { timestamp: minutesAgo(8), level: "error", message: "payment capture failed: context deadline exceeded" },
      { timestamp: minutesAgo(7), level: "error", message: "OOMKilled: container payments-api exceeded memory limit" },
      { timestamp: minutesAgo(6), level: "error", message: "pod payments-api-7d4f9c-x2m entered CrashLoopBackOff" },
      { timestamp: minutesAgo(5), level: "fatal", message: "FATAL: worker exited after repeated restarts" },
      { timestamp: minutesAgo(4), level: "error", message: "upstream connect error: no healthy backends" },
    ],
  },
  {
    eventId: "seed-checkout-cards",
    source: "website",
    title: "Card payments failing at the final step",
    service: "checkout-web",
    severity: "medium",
    description:
      "Customers report that card payments fail on the final checkout step. The spinner runs for about thirty seconds and then shows a generic error. Several people said a second attempt worked. Started some time this afternoon; three separate reports in the last hour.",
  },
  {
    eventId: "seed-auth-tokens",
    source: "monitoring",
    title: "auth-service: elevated error rate",
    service: "auth-service",
    severity: "high",
    description: "6/20 entries are errors (30%). No crash signals; token validation is the common thread.",
    evidence: [
      { timestamp: minutesAgo(22), level: "error", message: "token validation failed: signature mismatch" },
      { timestamp: minutesAgo(20), level: "error", message: "token validation failed: signature mismatch" },
      { timestamp: minutesAgo(18), level: "warn", message: "jwks cache refreshed after miss" },
      { timestamp: minutesAgo(15), level: "error", message: "session refresh rejected for 41 clients in 60s" },
    ],
  },
  {
    eventId: "seed-search-latency",
    source: "manual",
    title: "Search autocomplete slow since this morning",
    service: "search-api",
    severity: "low",
    description:
      "Autocomplete suggestions take two to three seconds to appear, where they used to be near instant. No errors are shown to the user and results are correct when they arrive. Noticed by the support team this morning; nobody has changed the search index that we know of.",
  },
];

const pool = await initPersistence().then(() => getPool());
if (!pool) {
  console.error("No database. Check DATABASE_URL and PERSIST, then run pnpm db:check.");
  process.exit(1);
}

try {
  if (process.argv.includes("--reset")) {
    const removed = await pool.query("DELETE FROM incoming_incidents WHERE event_id = ANY($1) RETURNING id", [
      SEEDS.map((s) => s.eventId),
    ]);
    console.log(`Removed ${removed.rowCount} seeded incident(s). Phases and reports went with them.`);
  } else {
    let inserted = 0;
    for (const seed of SEEDS) {
      const result = await pool.query(
        `INSERT INTO incoming_incidents(id, source, event_id, title, service, severity, description, evidence)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source,event_id) DO NOTHING RETURNING id`,
        [
          `INC-${randomUUID()}`,
          seed.source,
          seed.eventId,
          seed.title,
          seed.service,
          seed.severity,
          seed.description,
          JSON.stringify(seed.evidence ?? []),
        ],
      );
      if (result.rowCount) inserted += 1;
    }
    console.log(
      inserted
        ? `Queued ${inserted} incident(s). The worker investigates them one at a time — ` +
            `about a minute and a half each — and the dashboard updates as each phase lands.`
        : "Nothing to do: these incidents are already in the database.",
    );
    console.log("Open http://localhost:3000/dashboard/incident-analysis to watch. Undo with pnpm seed:incidents --reset.");
  }
} finally {
  await closePersistence();
}
