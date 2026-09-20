import type { TimedEvent } from "../events.js";
import { getPool } from "./pool.js";

/**
 * Persists one run's timeline without ever getting in its way.
 *
 * `EventStream.emit` is synchronous and sits on the hot path of the live SSE
 * stream, while pg is async — so writes are queued rather than awaited. The
 * queue is a promise chain, which keeps them in `seq` order without a second
 * connection or any locking.
 *
 * Failures are swallowed after the first. A database that goes away mid-run
 * must not abort the investigation, and it must not print the same error
 * sixty times either.
 */
export class RunWriter {
  private chain: Promise<void> = Promise.resolve();
  private broken = false;

  constructor(private readonly runId: string) {}

  private enqueue(work: (query: QueryFn) => Promise<void>): void {
    this.chain = this.chain.then(async () => {
      if (this.broken) return;
      const pool = getPool();
      if (!pool) return;

      try {
        await work((text, values) => pool.query(text, values));
      } catch (error) {
        this.broken = true;
        console.warn(
          `[persistence] run ${this.runId} is no longer being recorded: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    });
  }

  begin(mode: "live" | "demo", incidentId: string | null): void {
    this.enqueue(async (query) => {
      await query(
        `INSERT INTO runs (id, mode, status, incident_id)
         VALUES ($1, $2, 'running', $3)
         ON CONFLICT (id) DO NOTHING`,
        [this.runId, mode, incidentId],
      );
    });
  }

  /**
   * Records one event and folds it into the findings tables.
   *
   * Both happen in the same statement batch so the derived rows can never
   * describe a timeline that was not itself stored.
   */
  record(event: TimedEvent): void {
    this.enqueue(async (query) => {
      const { at, seq, type, ...payload } = event;

      await query(
        `INSERT INTO run_events (run_id, seq, at_ms, type, payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (run_id, seq) DO NOTHING`,
        [this.runId, seq, at, type, JSON.stringify(payload)],
      );

      await this.fold(query, event);
    });
  }

  private async fold(query: QueryFn, event: TimedEvent): Promise<void> {
    switch (event.type) {
      case "started":
        await query(`UPDATE runs SET incident_id = $2 WHERE id = $1`, [this.runId, event.incidentId]);
        return;

      case "demo_mode":
        await query(`UPDATE runs SET mode = 'demo', demo_reason = $2 WHERE id = $1`, [
          this.runId,
          event.reason,
        ]);
        return;

      case "hypothesis":
        await query(
          `INSERT INTO hypotheses (run_id, hypothesis_id, hypothesis, confidence, rationale)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (run_id, hypothesis_id) DO UPDATE
             SET hypothesis = EXCLUDED.hypothesis,
                 confidence = EXCLUDED.confidence,
                 rationale  = EXCLUDED.rationale`,
          [this.runId, event.id, event.hypothesis, Math.round(event.confidence), event.rationale],
        );
        return;

      case "evidence":
        await query(
          `INSERT INTO evidence (run_id, hypothesis_id, evidence, supports, source)
           VALUES ($1, $2, $3, $4, $5)`,
          [this.runId, event.hypothesisId, event.evidence, event.supports, event.source],
        );
        return;

      case "root_cause":
        await query(
          `INSERT INTO root_causes (run_id, hypothesis_id, explanation, confidence)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (run_id) DO UPDATE
             SET hypothesis_id = EXCLUDED.hypothesis_id,
                 explanation   = EXCLUDED.explanation,
                 confidence    = EXCLUDED.confidence`,
          [this.runId, event.hypothesisId, event.explanation, Math.round(event.confidence)],
        );
        return;

      case "patch":
        await query(
          `INSERT INTO patches (run_id, path, diff, rationale) VALUES ($1, $2, $3, $4)`,
          [this.runId, event.path, event.diff, event.rationale],
        );
        return;

      case "test":
        await query(
          `INSERT INTO test_results (run_id, passed, failed, total, failures)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (run_id) DO UPDATE
             SET passed   = EXCLUDED.passed,
                 failed   = EXCLUDED.failed,
                 total    = EXCLUDED.total,
                 failures = EXCLUDED.failures`,
          [this.runId, event.passed, event.failed, event.total, JSON.stringify(event.failures)],
        );
        return;

      case "memory":
        await query(
          `INSERT INTO memory_measurements
             (run_id, before_mb, after_mb, before_per_txn, after_per_txn, reduction_percent)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (run_id) DO UPDATE
             SET before_mb         = EXCLUDED.before_mb,
                 after_mb          = EXCLUDED.after_mb,
                 before_per_txn    = EXCLUDED.before_per_txn,
                 after_per_txn     = EXCLUDED.after_per_txn,
                 reduction_percent = EXCLUDED.reduction_percent`,
          [
            this.runId,
            event.beforeMB,
            event.afterMB,
            event.beforePerTxn,
            event.afterPerTxn,
            event.reductionPercent,
          ],
        );
        return;

      case "report":
        await query(
          `INSERT INTO reports (run_id, markdown) VALUES ($1, $2)
           ON CONFLICT (run_id) DO UPDATE SET markdown = EXCLUDED.markdown`,
          [this.runId, event.markdown],
        );
        return;

      case "resolved":
        await query(
          `UPDATE runs SET status = 'resolved', finished_at = now(), duration_ms = $2 WHERE id = $1`,
          [this.runId, event.durationMs],
        );
        return;

      case "error":
        if (event.fatal) {
          await query(
            `UPDATE runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
            [this.runId, event.message],
          );
        }
        return;

      default:
        return;
    }
  }

  /**
   * Marks a run that ended without a terminal event — an abort, a crash, a
   * process kill. Without this those rows would sit at 'running' forever.
   */
  finalize(elapsedMs: number): void {
    this.enqueue(async (query) => {
      await query(
        `UPDATE runs
            SET status      = CASE WHEN status = 'running' THEN 'failed' ELSE status END,
                finished_at = COALESCE(finished_at, now()),
                duration_ms = COALESCE(duration_ms, $2)
          WHERE id = $1`,
        [this.runId, Math.round(elapsedMs)],
      );
    });
  }

  /** Waits for the queued writes to drain. */
  flush(): Promise<void> {
    return this.chain;
  }
}

type QueryFn = (text: string, values?: unknown[]) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface RunSummary {
  id: string;
  mode: string;
  status: string;
  incidentId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  rootCause: string | null;
  testsPassed: number | null;
  testsTotal: number | null;
}

/** Most recent runs first. */
export async function listRuns(limit = 20): Promise<RunSummary[]> {
  const pool = getPool();
  if (!pool) return [];

  const { rows } = await pool.query(
    `SELECT r.id, r.mode, r.status, r.incident_id, r.started_at, r.finished_at, r.duration_ms,
            rc.explanation AS root_cause,
            t.passed       AS tests_passed,
            t.total        AS tests_total
       FROM runs r
       LEFT JOIN root_causes  rc ON rc.run_id = r.id
       LEFT JOIN test_results t  ON t.run_id  = r.id
      ORDER BY r.started_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)],
  );

  return rows.map((row) => ({
    id: row.id,
    mode: row.mode,
    status: row.status,
    incidentId: row.incident_id,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    durationMs: row.duration_ms,
    rootCause: row.root_cause,
    testsPassed: row.tests_passed,
    testsTotal: row.tests_total,
  }));
}

/**
 * The stored timeline for one run, in the wire shape the dashboard already
 * consumes — so a past run can be replayed through the same reducer as a live
 * one with no special case on the client.
 */
export async function loadRunEvents(runId: string): Promise<TimedEvent[]> {
  const pool = getPool();
  if (!pool) return [];

  const { rows } = await pool.query(
    `SELECT seq, at_ms, type, payload FROM run_events WHERE run_id = $1 ORDER BY seq`,
    [runId],
  );

  return rows.map((row) => ({ ...row.payload, type: row.type, at: row.at_ms, seq: row.seq }) as TimedEvent);
}
