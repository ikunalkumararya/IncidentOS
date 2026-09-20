import { readFileSync } from "node:fs";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { requireAuth } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { seedDemoUser } from "./auth/users.js";
import {
  API_KEY,
  DEMO_DATA,
  FORCE_DEMO_MODE,
  JWT_SECRET_IS_DEFAULT,
  MODEL,
  PORT,
  SEED_DEMO_USER,
  WEB_ORIGIN,
} from "./config.js";
import { initPersistence, isPersistenceReady } from "./db/pool.js";
import { listRuns, loadRunEvents } from "./db/store.js";
import { loadIncident } from "./incidents/index.js";
import { loadFallback } from "./recorder.js";
import { getRun, startRun } from "./runner.js";
import { buildAttackAnalysis } from "./security/index.js";
import { LOG_FILES, lines as logLines } from "./tools/searchLogs.js";
import { buildTimeline } from "./timeline.js";

import { incidentRouter, webhookRouter } from "./incidents/routes.js";
import { startIncidentWorker } from "./incidents/worker.js";

const app = express();

// Credentialed requests need an explicit origin — a wildcard is rejected by
// the browser once cookies are involved.
app.use(cors({ origin: WEB_ORIGIN, credentials: true }));
app.use("/api/webhooks", webhookRouter);
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/incidents", incidentRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    // Never leak the key itself, only whether one is configured.
    hasApiKey: Boolean(API_KEY),
    demoMode: FORCE_DEMO_MODE,
    hasRecording: Boolean(loadFallback()),
    persistence: isPersistenceReady(),
  });
});

/** Past runs, newest first. Empty when persistence is unavailable. */
app.get("/api/runs", requireAuth, async (req, res) => {
  if (!isPersistenceReady()) {
    res.json({ persistence: false, runs: [] });
    return;
  }
  const limit = Number(req.query.limit ?? 20);
  const runs = await listRuns(Number.isFinite(limit) ? limit : 20);
  res.json({ persistence: true, runs });
});

/**
 * The stored timeline for one run, in the same wire shape as the live stream
 * so the dashboard can replay history through its existing reducer.
 */
app.get("/api/runs/:id/events", requireAuth, async (req, res) => {
  if (!isPersistenceReady()) {
    res.status(503).json({ error: "persistence is not available" });
    return;
  }
  const events = await loadRunEvents(req.params.id);
  if (!events.length) {
    res.status(404).json({ error: "unknown run" });
    return;
  }
  res.json({ runId: req.params.id, events });
});

app.get("/api/incident", requireAuth, (_req, res) => {
  res.json(loadIncident());
});

/** Series behind the incident-card chart, plus the events worth annotating. */
app.get("/api/timeline", requireAuth, (_req, res) => {
  res.json(buildTimeline());
});

/**
 * Everything behind the attack-analysis tab: the campaign summary, the
 * per-minute attempt series, the attributed sources and the control events.
 */
app.get("/api/attack-analysis", requireAuth, (_req, res) => {
  res.json(buildAttackAnalysis());
});

app.post("/api/investigations", requireAuth, (_req, res) => {
  const run = startRun("incident");
  res.status(201).json({ runId: run.id, mode: run.mode });
});

app.post("/api/attack-investigations", requireAuth, (_req, res) => {
  const run = startRun("attack");
  res.status(201).json({ runId: run.id, mode: run.mode });
});

/** Tail of one log stream, for the attack tab's logs panel. */
app.get("/api/logs", requireAuth, (req, res) => {
  const stream = typeof req.query.stream === "string" ? req.query.stream : "payments-api-errors";
  if (!(stream in LOG_FILES)) {
    res.status(400).json({ error: `unknown log stream: ${stream}` });
    return;
  }
  const requested = Number(req.query.limit ?? 120);
  const limit = Math.min(500, Math.max(1, Number.isFinite(requested) ? requested : 120));
  const all = logLines(LOG_FILES[stream]);
  res.json({ stream, lines: all.slice(-limit) });
});

/** Raw Kubernetes events + pod status, for the attack tab's kubernetes panel. */
app.get("/api/kubernetes-events", requireAuth, (_req, res) => {
  const events = JSON.parse(readFileSync(join(DEMO_DATA, "kubernetes", "events.json"), "utf8"));
  const pods = JSON.parse(readFileSync(join(DEMO_DATA, "kubernetes", "pods.json"), "utf8"));
  res.json({ events: events.events, pods: pods.pods });
});

/**
 * Server-Sent Events for one run.
 *
 * Subscribing replays everything emitted so far before attaching, so a client
 * that connects late — or reconnects — sees the whole investigation rather
 * than joining mid-timeline.
 */
app.get("/api/investigations/:id/events", requireAuth, (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "unknown run" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const unsubscribe = run.stream.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "resolved" || (event.type === "error" && event.fatal)) {
      res.write("event: done\ndata: {}\n\n");
    }
  });

  // Comment frames keep intermediaries from closing an idle connection while
  // the agent is thinking.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", close);
  res.on("close", close);
});

// Connect before listening so the first investigation is recorded rather than
// racing the pool. A failure here is reported and then ignored: persistence is
// an enhancement, and the demo has to survive a database that is not running.
const persistence = await initPersistence();
startIncidentWorker();

// Accounts live in Postgres, so seeding can only happen once it is up. A
// fresh database is otherwise unusable: every page behind sign-in would be
// unreachable with no way to register that the demo script mentions.
let seeded: string | null = null;
if (persistence.ok && SEED_DEMO_USER) {
  seeded = await seedDemoUser()
    .then((r) => r.email)
    .catch(() => null);
}

app.listen(PORT, () => {
  console.log(`IncidentOS server listening on http://localhost:${PORT}`);
  console.log(`  model      ${MODEL}`);
  console.log(`  api key    ${API_KEY ? "configured" : "MISSING — will fall back to the recorded run"}`);
  console.log(`  recording  ${loadFallback() ? "available" : "none yet"}`);
  console.log(
    `  database   ${persistence.ok ? persistence.detail : `unavailable — runs will not be saved (${persistence.detail})`}`,
  );
  console.log(
    `  accounts   ${
      persistence.ok
        ? seeded
          ? `ready — sign in as ${seeded}`
          : SEED_DEMO_USER ? "unavailable — seeding failed" : "ready — register at /signup"
        : "DISABLED — sign-in needs the database (pnpm db:up)"
    }`,
  );
  if (FORCE_DEMO_MODE) console.log("  DEMO_MODE  forced — the API will not be called");
  if (JWT_SECRET_IS_DEFAULT) {
    console.warn(
      "  WARNING    JWT_SECRET is unset, so sessions are signed with the public default key.\n" +
        "             Fine for a local demo; set JWT_SECRET before exposing this anywhere.",
    );
  }
});
