import { randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import { requireAuth } from "../auth/middleware.js";
import { getPool } from "../db/pool.js";
import { detectAnomaly, logSchema, reportSchema, validSignature } from "./intake.js";
import { PHASES } from "./phases.js";

const safe = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(() => res.status(503).json({ error: "Incident storage unavailable. Please retry." }));
};
const database: RequestHandler = (_req, res, next) => {
  if (!getPool()) { res.status(503).json({ error: "Incident storage unavailable" }); return; }
  next();
};

export async function insertIncident(source: string, data: { eventId: string; title: string; service: string; severity: string; description: string }, evidence: unknown[] = []) {
  const pool = getPool()!;
  const result = await pool.query(
    `INSERT INTO incoming_incidents(id, source, event_id, title, service, severity, description, evidence)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source,event_id) DO NOTHING RETURNING *`,
    [`INC-${randomUUID()}`, source, data.eventId, data.title, data.service, data.severity, data.description, JSON.stringify(evidence)],
  );
  const incident = result.rows[0] ?? (await pool.query("SELECT * FROM incoming_incidents WHERE source=$1 AND event_id=$2", [source, data.eventId])).rows[0];
  return { incident, duplicate: result.rowCount === 0 };
}

// Mounted before the global JSON parser so signatures cover original bytes.
export const webhookRouter = express.Router();
webhookRouter.use(express.raw({ type: "application/json", limit: "512kb" }));
webhookRouter.use((req, res, next) => {
  const secret = process.env.INCIDENT_WEBHOOK_SECRET;
  if (!secret) { res.status(503).json({ error: "Webhook intake is not configured" }); return; }
  if (!Buffer.isBuffer(req.body) || !validSignature(req.body, req.get("x-incident-timestamp") ?? "", req.get("x-incident-signature") ?? "", secret)) {
    res.status(401).json({ error: "Invalid webhook signature or timestamp" }); return;
  }
  try { req.body = JSON.parse(req.body.toString("utf8")); } catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  next();
});
webhookRouter.use(database);
webhookRouter.post("/incidents", safe(async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid report", fields: parsed.error.flatten() }); return; }
  const result = await insertIncident("website", parsed.data);
  res.status(result.duplicate ? 200 : 202).json({ id: result.incident.id, status: result.incident.status, duplicate: result.duplicate });
}));
webhookRouter.post("/logs", safe(async (req, res) => {
  const parsed = logSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid log batch", fields: parsed.error.flatten() }); return; }
  let anomaly;
  try { anomaly = detectAnomaly(parsed.data); } catch { res.status(400).json({ error: "Log batches must cover at most five minutes" }); return; }
  if (!anomaly) { res.json({ detected: false }); return; }
  const result = await insertIncident("monitoring", { ...anomaly, eventId: parsed.data.eventId, service: parsed.data.service }, parsed.data.entries);
  res.status(result.duplicate ? 200 : 202).json({ detected: true, id: result.incident.id, status: result.incident.status, duplicate: result.duplicate });
}));

export const incidentRouter = express.Router();
incidentRouter.use(requireAuth, database);
incidentRouter.delete("/:id", safe(async (req, res) => {
  // Phase history is removed by the foreign key's ON DELETE CASCADE.
  // A worker holding this incident cannot recreate it after deletion.
  const result = await getPool()!.query("DELETE FROM incoming_incidents WHERE id=$1 RETURNING id", [req.params.id]);
  if (!result.rowCount) { res.status(404).json({ error: "Incident not found" }); return; }
  res.json({ deleted: true, id: result.rows[0].id });
}));
incidentRouter.get("/", safe(async (_req, res) => {
  // phases_done lets the list show progress without fetching every phase row.
  const result = await getPool()!.query(`SELECT i.id,i.title,i.service,i.severity,i.source,i.status,i.created_at,i.updated_at,
    (SELECT count(*) FROM incident_phases p WHERE p.incident_id=i.id AND p.status='done')::int AS phases_done
    FROM incoming_incidents i ORDER BY i.created_at DESC LIMIT 100`);
  res.json({ incidents: result.rows });
}));
incidentRouter.post("/", safe(async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a title, service, and description of at least 10 characters." }); return; }
  const result = await insertIncident("manual", parsed.data);
  res.status(result.duplicate ? 200 : 202).json(result);
}));
incidentRouter.get("/:id", safe(async (req, res) => {
  const result = await getPool()!.query("SELECT id,title,service,severity,source,status,description,evidence,report,error,attempts,created_at,updated_at FROM incoming_incidents WHERE id=$1", [req.params.id]);
  if (!result.rows[0]) { res.status(404).json({ error: "Incident not found" }); return; }
  // The per-phase timings the dashboard renders as the investigation unfolds.
  const phases = await getPool()!.query("SELECT seq,phase,status,output,started_at,finished_at,duration_ms FROM incident_phases WHERE incident_id=$1 ORDER BY seq", [req.params.id]);
  // The plan travels with the incident so the dashboard can show the steps
  // that have not started yet without keeping its own copy of the list.
  const plan = PHASES.map(({ key, label, running }) => ({ key, label, running }));
  res.json({ ...result.rows[0], phases: phases.rows, phasePlan: plan });
}));
incidentRouter.post("/:id/retry", safe(async (req, res) => {
  const result = await getPool()!.query("UPDATE incoming_incidents SET status='queued', attempts=0, error=NULL, updated_at=now() WHERE id=$1 AND status='failed' RETURNING id", [req.params.id]);
  if (!result.rowCount) { res.status(409).json({ error: "Only failed investigations can be retried" }); return; }
  res.status(202).json({ id: result.rows[0].id });
}));
