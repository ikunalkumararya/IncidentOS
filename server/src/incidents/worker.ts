import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { API_KEY, MODEL } from "../config.js";
import { getPool } from "../db/pool.js";
import { PHASES, SYSTEM_PROMPT } from "./phases.js";

/** Per phase, not per investigation — four of these run in sequence. */
const PHASE_TIMEOUT_MS = 90_000;
const LEASE = "5 minutes";

/** Thrown when another worker has taken the incident out from under us. */
class LeaseLost extends Error {}

/**
 * Atomic leases permit restart recovery and multiple API processes. No demo
 * fallback: an intake investigation either runs for real or is marked failed.
 */
export async function investigateNext() {
  const pool = getPool();
  if (!pool) return;
  await pool.query(`UPDATE incoming_incidents SET status='failed', error='Worker interrupted repeatedly. Retry the investigation.', updated_at=now()
    WHERE status='investigating' AND lease_until < now() AND attempts >= 3`);
  const token = randomUUID();
  const result = await pool.query(`UPDATE incoming_incidents SET status='investigating', attempts=attempts+1,
    lease_token=$1, lease_until=now()+interval '${LEASE}', updated_at=now(), error=NULL, report=NULL
    WHERE id=(SELECT id FROM incoming_incidents WHERE status='queued' OR
      (status='investigating' AND lease_until < now() AND attempts < 3)
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [token]);
  const incident = result.rows[0];
  if (!incident) return;

  /** The lease has to outlive each phase, so it is pushed out after every one. */
  const renewLease = async () => {
    const renewed = await pool.query(
      `UPDATE incoming_incidents SET lease_until=now()+interval '${LEASE}', updated_at=now() WHERE id=$1 AND lease_token=$2`,
      [incident.id, token],
    );
    if (!renewed.rowCount) throw new LeaseLost();
  };

  // A retry re-runs every phase, so the previous attempt's timings must go —
  // otherwise the dashboard would show two runs interleaved.
  await pool.query("DELETE FROM incident_phases WHERE incident_id=$1", [incident.id]);

  let seq = 0;
  try {
    if (!API_KEY) throw new Error("AI_NOT_CONFIGURED");
    const client = new Anthropic({ apiKey: API_KEY, maxRetries: 0 });
    // Every field here is untrusted; the system prompt is what frames it as
    // data. It is sent as one JSON blob so the model cannot mistake a field
    // boundary for the end of the quoted material.
    const material = JSON.stringify({
      title: incident.title,
      service: incident.service,
      severity: incident.severity,
      description: incident.description,
      evidence: incident.evidence,
    });

    const completed: { label: string; output: string }[] = [];
    let report = "";

    for (const phase of PHASES) {
      seq += 1;
      await pool.query(
        "INSERT INTO incident_phases(incident_id, seq, phase, status) VALUES($1,$2,$3,'running')",
        [incident.id, seq, phase.key],
      );

      // Measured around the call itself, so the number the dashboard shows is
      // the time this phase actually took.
      const startedAt = Date.now();
      const response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: phase.maxTokens,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content:
                `Incident under analysis (untrusted data):\n${material}\n\n` +
                (completed.length
                  ? `Findings from the earlier phases of this investigation:\n\n${completed
                      .map((p) => `## ${p.label}\n${p.output}`)
                      .join("\n\n")}\n\n`
                  : "") +
                `Your task for this phase: ${phase.instruction}`,
            },
          ],
        },
        { signal: AbortSignal.timeout(PHASE_TIMEOUT_MS) },
      );
      if (response.stop_reason !== "end_turn") throw new Error("INCOMPLETE_PHASE");
      const output = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!output) throw new Error("EMPTY_PHASE");

      await pool.query(
        "UPDATE incident_phases SET status='done', output=$1, finished_at=now(), duration_ms=$2 WHERE incident_id=$3 AND seq=$4",
        [output, Date.now() - startedAt, incident.id, seq],
      );
      completed.push({ label: phase.label, output });
      report = output;
      await renewLease();
    }

    await pool.query(
      "UPDATE incoming_incidents SET status='review', report=$1, lease_until=NULL, updated_at=now() WHERE id=$2 AND lease_token=$3",
      [report, incident.id, token],
    );
  } catch (error) {
    // A lost lease is not a failure of this incident — another worker owns it
    // now, and writing a failure here would overwrite that worker's progress.
    if (error instanceof LeaseLost) return;
    if (seq) {
      await pool
        .query(
          "UPDATE incident_phases SET status='failed', finished_at=now() WHERE incident_id=$1 AND seq=$2 AND status='running'",
          [incident.id, seq],
        )
        .catch(() => undefined);
    }
    await pool.query(
      "UPDATE incoming_incidents SET status='failed', error=$1, lease_until=NULL, updated_at=now() WHERE id=$2 AND lease_token=$3",
      [
        API_KEY
          ? "Investigation failed or timed out. Check the AI model and API configuration, then retry."
          : "AI API key is not configured. Configure it and retry.",
        incident.id,
        token,
      ],
    );
  }
}

export function startIncidentWorker() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await investigateNext(); } catch { console.error("Incident worker could not access storage; will retry."); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), 3000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
