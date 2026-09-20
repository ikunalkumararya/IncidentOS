import cors from "cors";
import express from "express";
import { API_KEY, FORCE_DEMO_MODE, MODEL, PORT } from "./config.js";
import { initPersistence, isPersistenceReady } from "./db/pool.js";
import { listRuns, loadRunEvents } from "./db/store.js";
import { loadIncident } from "./incidents/index.js";
import { loadFallback } from "./recorder.js";
import { getRun, startInvestigation } from "./runner.js";
import { buildTimeline } from "./timeline.js";

const app = express();
app.use(cors());
app.use(express.json());

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
app.get("/api/runs", async (req, res) => {
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
app.get("/api/runs/:id/events", async (req, res) => {
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

app.get("/api/incident", (_req, res) => {
  res.json(loadIncident());
});

/** Series behind the incident-card chart, plus the events worth annotating. */
app.get("/api/timeline", (_req, res) => {
  res.json(buildTimeline());
});

app.post("/api/investigations", (_req, res) => {
  const run = startInvestigation();
  res.status(201).json({ runId: run.id, mode: run.mode });
});

/**
 * Server-Sent Events for one run.
 *
 * Subscribing replays everything emitted so far before attaching, so a client
 * that connects late — or reconnects — sees the whole investigation rather
 * than joining mid-timeline.
 */
app.get("/api/investigations/:id/events", (req, res) => {
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

app.listen(PORT, () => {
  console.log(`IncidentOS server listening on http://localhost:${PORT}`);
  console.log(`  model      ${MODEL}`);
  console.log(`  api key    ${API_KEY ? "configured" : "MISSING — will fall back to the recorded run"}`);
  console.log(`  recording  ${loadFallback() ? "available" : "none yet"}`);
  console.log(
    `  database   ${persistence.ok ? persistence.detail : `unavailable — runs will not be saved (${persistence.detail})`}`,
  );
  if (FORCE_DEMO_MODE) console.log("  DEMO_MODE  forced — the API will not be called");
});
