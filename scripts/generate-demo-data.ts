/**
 * Generates every file under demo-data/{logs,metrics,kubernetes,deployments}
 * from one simulation of the incident, so the fixtures can never disagree with
 * each other. The simulation is seeded, so re-running produces byte-identical
 * output.
 *
 * The §16 timeline is encoded as assertions at the bottom: if a tuning change
 * moves "memory reaches 70% at 14:27", generation fails instead of silently
 * shipping fixtures that contradict the demo script.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "demo-data");

const DATE = "2026-03-11";
const SERVICE = "payments-api";
const NAMESPACE = "payments";
const MEMORY_LIMIT_MIB = 2048;

/** Deterministic PRNG (mulberry32) so fixtures are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(48210);
const jitter = (spread: number) => (rand() - 0.5) * 2 * spread;

const minuteOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const iso = (minute: number, second = 0) =>
  `${DATE}T${hhmm(minute)}:${String(second).padStart(2, "0")}Z`;

const START = minuteOf("14:00");
const END = minuteOf("14:45");
const MINUTES = Array.from({ length: END - START + 1 }, (_, i) => START + i);

// ---------------------------------------------------------------------------
// Pod simulation
// ---------------------------------------------------------------------------

const REPLICA_SET_183 = "payments-api-6c8b94d7f9";
const REPLICA_SET_184 = "payments-api-7d9f8b6c4b";

/**
 * Each pod is defined by *when its first OOM kill should happen*; the heap
 * growth rate is derived from that. The §16 timeline is therefore something you
 * edit directly here, rather than a property you have to reverse-engineer out
 * of a growth constant.
 *
 * The kills are deliberately spread out. If several pods hit the limit in the
 * same minute the service loses most of its capacity at once and the error rate
 * jumps past 60%, which contradicts the 18.7% on the incident card.
 */
type Pod = {
  name: string;
  /** Minute the v1.8.4 container came up on this pod (rolling update). */
  rolloutAt: number;
  /** Minute this pod should first be OOM-killed. */
  firstOomAt: number;
  baseline: number;
};

const PODS: Pod[] = [
  { name: `${REPLICA_SET_184}-2xkqd`, rolloutAt: minuteOf("14:22"), firstOomAt: minuteOf("14:30"), baseline: 39 },
  { name: `${REPLICA_SET_184}-8vn4t`, rolloutAt: minuteOf("14:22"), firstOomAt: minuteOf("14:33"), baseline: 38 },
  { name: `${REPLICA_SET_184}-hb7wz`, rolloutAt: minuteOf("14:23"), firstOomAt: minuteOf("14:35"), baseline: 40 },
  // 14:39, not 14:38: pod 2xkqd re-enters its crash loop and is killed a second
  // time at 14:38, and two kills in one minute drop the service below the error
  // budget the incident card claims.
  { name: `${REPLICA_SET_184}-m5rjp`, rolloutAt: minuteOf("14:23"), firstOomAt: minuteOf("14:39"), baseline: 38 },
  { name: `${REPLICA_SET_184}-q9tlc`, rolloutAt: minuteOf("14:24"), firstOomAt: minuteOf("14:40"), baseline: 39 },
];

/** An OOM kill fires when a pod's working set crosses this share of its limit. */
const OOM_THRESHOLD = 97;

/** Percentage points of heap growth per minute, derived from the target kill. */
const growthPerMin = (pod: Pod) =>
  (OOM_THRESHOLD - pod.baseline) / (pod.firstOomAt - pod.rolloutAt);

type Restart = { pod: string; minute: number; second: number; count: number };

const memoryByPod = new Map<string, Map<number, number>>();
const killMinutesByPod = new Map<string, Set<number>>();
const restarts: Restart[] = [];

for (const pod of PODS) {
  const series = new Map<number, number>();
  const kills = new Set<number>();
  const rate = growthPerMin(pod);
  let restartCount = 0;
  // Minute at which the current container generation started growing.
  let growthOrigin = pod.rolloutAt;

  for (const minute of MINUTES) {
    let value: number;
    if (minute < pod.rolloutAt) {
      // v1.8.3: flat, healthy.
      value = pod.baseline + jitter(1.4);
    } else {
      // The OOM test uses the un-jittered trend so that sample noise can never
      // move a kill into the wrong minute; jitter only perturbs what's reported.
      const trend = pod.baseline + (minute - growthOrigin) * rate;
      if (trend >= OOM_THRESHOLD) {
        restartCount += 1;
        kills.add(minute);
        restarts.push({
          pod: pod.name,
          minute,
          second: Math.floor(rand() * 40) + 8,
          count: restartCount,
        });
        // Container is killed and restarted within the same minute; the sample
        // recorded for that minute is the post-restart working set. The pod then
        // starts leaking again — a crash loop, not a one-off.
        growthOrigin = minute;
        value = pod.baseline + jitter(0.8);
      } else {
        value = trend + jitter(0.8);
      }
    }
    series.set(minute, Math.max(0, Number(value.toFixed(1))));
  }
  memoryByPod.set(pod.name, series);
  killMinutesByPod.set(pod.name, kills);
}

restarts.sort((a, b) => a.minute - b.minute || a.second - b.second);

const avgMemory = (minute: number) => {
  const values = PODS.map((p) => memoryByPod.get(p.name)!.get(minute)!);
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
};

/** Peak across pods — this is what an operator's alert actually fires on. */
const peakMemory = (minute: number) =>
  Math.max(...PODS.map((p) => memoryByPod.get(p.name)!.get(minute)!));

// ---------------------------------------------------------------------------
// Traffic and errors
// ---------------------------------------------------------------------------

// Requests barely move — this is what lets Claude eliminate the traffic-spike
// hypothesis. Peak is ~8% over the pre-deploy baseline.
const BASE_RPM = 1240;
const requestsAt = (minute: number) => {
  const rampMinutes = Math.max(0, minute - minuteOf("14:05"));
  const drift = Math.min(8, rampMinutes * 0.28) / 100;
  return Math.round(BASE_RPM * (1 + drift) + jitter(14));
};

/**
 * 500s track pod *availability*, not traffic. Traffic is shared evenly across
 * the 5 pods, so the service error rate is the mean of the per-pod failure
 * rates. A pod fails requests for two reasons:
 *
 *   1. It is being OOM-killed or is coming back up (in-flight requests reset,
 *      then the readiness probe fails for ~2 minutes).
 *   2. It is close to the limit and GC-thrashing, so some requests time out.
 *
 * This is what keeps the traffic-spike hypothesis falsifiable: errors are a
 * function of heap, and heap is a function of uptime-since-deploy — neither
 * one has any term in it that depends on request volume.
 */
const GC_THRASH_ONSET = 76;
const podFailureRate = (pod: Pod, minute: number) => {
  const kills = killMinutesByPod.get(pod.name)!;
  if (kills.has(minute)) return 65; // killed mid-minute
  if (kills.has(minute - 1)) return 55; // restarting, probe failing
  if (kills.has(minute - 2)) return 20; // probe passing again, warming up

  const mem = memoryByPod.get(pod.name)!.get(minute)!;
  const pressure = Math.min(1, Math.max(0, (mem - GC_THRASH_ONSET) / (OOM_THRESHOLD - GC_THRASH_ONSET)));
  return Math.pow(pressure, 1.7) * 25;
};

const errorRateAt = (minute: number) => {
  const mean = PODS.reduce((sum, p) => sum + podFailureRate(p, minute), 0) / PODS.length;
  return Number(Math.max(0, mean + (mean > 0.5 ? jitter(0.3) : 0)).toFixed(1));
};

const peakErrorRate = Math.max(...MINUTES.map(errorRateAt));

const cpuAt = (minute: number) => {
  // GC pressure lifts CPU slightly as the heap fills, but never saturates —
  // another dead end the agent should rule out.
  const mem = avgMemory(minute);
  const gcOverhead = mem > 70 ? (mem - 70) * 0.22 : 0;
  return Number((34 + gcOverhead + jitter(2.2)).toFixed(1));
};

// ---------------------------------------------------------------------------
// Metrics files
// ---------------------------------------------------------------------------

type Series = { t: string; value: number };

const metricFile = (
  metric: string,
  unit: string,
  description: string,
  points: Series[],
  extra: Record<string, unknown> = {},
) => ({
  service: SERVICE,
  metric,
  unit,
  description,
  interval: "1m",
  window: { start: iso(START), end: iso(END) },
  points,
  ...extra,
});

const memoryPoints = MINUTES.map((m) => ({ t: iso(m), value: avgMemory(m) }));

writeFileSync(
  join(OUT, "metrics", "memory.json"),
  JSON.stringify(
    metricFile(
      "memory",
      "percent_of_limit",
      `Container working set as a percentage of the ${MEMORY_LIMIT_MIB}Mi limit, averaged across pods.`,
      memoryPoints,
      {
        limitMiB: MEMORY_LIMIT_MIB,
        peak: MINUTES.map((m) => ({ t: iso(m), value: peakMemory(m) })),
        byPod: Object.fromEntries(
          PODS.map((p) => [
            p.name,
            MINUTES.map((m) => ({ t: iso(m), value: memoryByPod.get(p.name)!.get(m)! })),
          ]),
        ),
      },
    ),
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(OUT, "metrics", "cpu.json"),
  JSON.stringify(
    metricFile(
      "cpu",
      "percent_of_request",
      "CPU utilisation as a percentage of the requested 500m, averaged across pods.",
      MINUTES.map((m) => ({ t: iso(m), value: cpuAt(m) })),
    ),
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(OUT, "metrics", "requests.json"),
  JSON.stringify(
    metricFile(
      "requests",
      "requests_per_minute",
      "Total inbound HTTP requests per minute across all pods.",
      MINUTES.map((m) => ({ t: iso(m), value: requestsAt(m) })),
      { baselineRpm: BASE_RPM },
    ),
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(OUT, "metrics", "errors.json"),
  JSON.stringify(
    metricFile(
      "errors",
      "percent_of_requests",
      "Share of inbound requests answered with HTTP 5xx.",
      MINUTES.map((m) => ({ t: iso(m), value: errorRateAt(m) })),
    ),
    null,
    2,
  ) + "\n",
);

// ---------------------------------------------------------------------------
// Deployment history
// ---------------------------------------------------------------------------

const deploymentHistory = {
  service: SERVICE,
  deployments: [
    {
      version: "v1.8.1",
      deployedAt: `${DATE}T11:04:00Z`,
      deployedBy: "ci-bot",
      commit: "4a1c9de",
      message: "chore(deps): bump fastify to 4.28.1",
      status: "superseded",
      changedFiles: ["package.json", "pnpm-lock.yaml"],
    },
    {
      version: "v1.8.2",
      deployedAt: `${DATE}T12:47:00Z`,
      deployedBy: "ci-bot",
      commit: "b73f0a2",
      message: "fix(refunds): correct rounding on partial refunds",
      status: "superseded",
      changedFiles: ["src/refunds.ts", "tests/refunds.test.ts"],
    },
    {
      version: "v1.8.3",
      deployedAt: `${DATE}T${hhmm(minuteOf("14:10"))}:00Z`,
      deployedBy: "ci-bot",
      commit: "9e2d4f7",
      message: "feat(metrics): expose /healthz readiness detail",
      status: "healthy",
      rolloutDurationSeconds: 96,
      changedFiles: ["src/health.ts"],
      notes: "Healthy for 11 minutes. No memory or error-rate change.",
    },
    {
      version: "v1.8.4",
      deployedAt: `${DATE}T${hhmm(minuteOf("14:21"))}:00Z`,
      deployedBy: "ci-bot",
      commit: "c41b8ea",
      message: "feat(transactions): add rolling aggregation window for settlement batching",
      status: "degraded",
      rolloutDurationSeconds: 141,
      changedFiles: [
        "src/transactions.ts",
        "src/aggregation.ts",
        "tests/transactions.test.ts",
      ],
      notes:
        "Rolling update completed at 14:23. Memory growth begins on each pod immediately after it picks up this revision.",
    },
  ],
  current: "v1.8.4",
  previousStable: "v1.8.3",
};

writeFileSync(
  join(OUT, "deployments", "history.json"),
  JSON.stringify(deploymentHistory, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Kubernetes events, pods, deployments
// ---------------------------------------------------------------------------

type K8sEvent = {
  timestamp: string;
  type: "Normal" | "Warning";
  reason: string;
  object: string;
  message: string;
  count: number;
};

const events: K8sEvent[] = [];

events.push({
  timestamp: iso(minuteOf("14:10"), 12),
  type: "Normal",
  reason: "ScalingReplicaSet",
  object: `deployment/${SERVICE}`,
  message: `Scaled up replica set ${REPLICA_SET_183} to 5`,
  count: 1,
});
events.push({
  timestamp: iso(minuteOf("14:21"), 4),
  type: "Normal",
  reason: "ScalingReplicaSet",
  object: `deployment/${SERVICE}`,
  message: `Scaled up replica set ${REPLICA_SET_184} to 1`,
  count: 1,
});

for (const pod of PODS) {
  events.push({
    timestamp: iso(pod.rolloutAt, 8),
    type: "Normal",
    reason: "Created",
    object: `pod/${pod.name}`,
    message: `Created container ${SERVICE} (image: registry.internal/payments-api:v1.8.4)`,
    count: 1,
  });
  events.push({
    timestamp: iso(pod.rolloutAt, 11),
    type: "Normal",
    reason: "Started",
    object: `pod/${pod.name}`,
    message: `Started container ${SERVICE}`,
    count: 1,
  });
}

events.push({
  timestamp: iso(minuteOf("14:23"), 27),
  type: "Normal",
  reason: "ScalingReplicaSet",
  object: `deployment/${SERVICE}`,
  message: `Scaled down replica set ${REPLICA_SET_183} to 0`,
  count: 1,
});

for (const restart of restarts) {
  events.push({
    timestamp: iso(restart.minute, restart.second),
    type: "Warning",
    reason: "OOMKilling",
    object: `pod/${restart.pod}`,
    message: `Memory cgroup out of memory: Killed process (node) total-vm:3612044kB, anon-rss:2089344kB, limit ${MEMORY_LIMIT_MIB}Mi`,
    count: 1,
  });
  events.push({
    timestamp: iso(restart.minute, Math.min(59, restart.second + 2)),
    type: "Warning",
    reason: "BackOff",
    object: `pod/${restart.pod}`,
    message: `Back-off restarting failed container ${SERVICE}`,
    count: restart.count,
  });
  events.push({
    timestamp: iso(restart.minute, Math.min(59, restart.second + 6)),
    type: "Normal",
    reason: "Started",
    object: `pod/${restart.pod}`,
    message: `Started container ${SERVICE} (restart #${restart.count})`,
    count: 1,
  });
}

events.push({
  timestamp: iso(minuteOf("14:35"), 18),
  type: "Warning",
  reason: "Unhealthy",
  object: `pod/${PODS[0].name}`,
  message: "Readiness probe failed: HTTP probe failed with statuscode: 503",
  count: 3,
});

events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

writeFileSync(
  join(OUT, "kubernetes", "events.json"),
  JSON.stringify({ namespace: NAMESPACE, service: SERVICE, events }, null, 2) + "\n",
);

const pods = PODS.map((pod) => {
  const podRestarts = restarts.filter((r) => r.pod === pod.name);
  const last = podRestarts.at(-1);
  return {
    name: pod.name,
    namespace: NAMESPACE,
    status: last ? "Running" : "Running",
    ready: "1/1",
    restarts: podRestarts.length,
    lastRestartAt: last ? iso(last.minute, last.second) : null,
    lastTerminationReason: last ? "OOMKilled" : null,
    lastTerminationExitCode: last ? 137 : null,
    startedAt: iso(pod.rolloutAt, 11),
    image: "registry.internal/payments-api:v1.8.4",
    node: `ip-10-42-${11 + PODS.indexOf(pod)}-7.eu-west-1.compute.internal`,
    resources: {
      requests: { cpu: "500m", memory: "1Gi" },
      limits: { cpu: "1500m", memory: `${MEMORY_LIMIT_MIB}Mi` },
    },
    currentMemoryPercent: memoryByPod.get(pod.name)!.get(END)!,
  };
});

writeFileSync(
  join(OUT, "kubernetes", "pods.json"),
  JSON.stringify({ namespace: NAMESPACE, service: SERVICE, pods }, null, 2) + "\n",
);

writeFileSync(
  join(OUT, "kubernetes", "deployments.json"),
  JSON.stringify(
    {
      namespace: NAMESPACE,
      deployments: [
        {
          name: SERVICE,
          replicas: { desired: 5, ready: 5 - Math.min(2, restarts.length ? 1 : 0), available: 4, updated: 5 },
          image: "registry.internal/payments-api:v1.8.4",
          revision: 47,
          strategy: "RollingUpdate",
          conditions: [
            {
              type: "Progressing",
              status: "True",
              reason: "NewReplicaSetAvailable",
              lastTransitionAt: iso(minuteOf("14:23"), 31),
            },
            {
              type: "Available",
              status: "False",
              reason: "MinimumReplicasUnavailable",
              lastTransitionAt: iso(minuteOf("14:36"), 2),
            },
          ],
          replicaSets: [
            { name: REPLICA_SET_183, revision: 46, image: "registry.internal/payments-api:v1.8.3", replicas: 0 },
            { name: REPLICA_SET_184, revision: 47, image: "registry.internal/payments-api:v1.8.4", replicas: 5 },
          ],
        },
      ],
    },
    null,
    2,
  ) + "\n",
);

// ---------------------------------------------------------------------------
// Application logs
// ---------------------------------------------------------------------------

type LogLine = { ts: string; level: string; pod: string; msg: string };
const appLog: LogLine[] = [];
const errorLog: LogLine[] = [];

const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];

// Pods serving traffic on the previous revision. Log lines before the rolling
// update must name these, not the v1.8.4 pods that did not exist yet.
const PODS_183 = ["nq4xv", "t8grm", "wd2fj", "z6hbp", "c3lky"].map(
  (suffix) => `${REPLICA_SET_183}-${suffix}`,
);

/** A pod name that plausibly existed at `minute`. */
const podAt = (minute: number) => {
  const live = PODS.filter((p) => p.rolloutAt <= minute).map((p) => p.name);
  const retiring = minute < minuteOf("14:24") ? PODS_183 : [];
  const candidates = [...live, ...retiring];
  return candidates.length ? pick(candidates) : pick(PODS_183);
};

const ROUTES = [
  "POST /v1/payments",
  "POST /v1/payments/capture",
  "GET /v1/payments/:id",
  "POST /v1/refunds",
];

for (const minute of MINUTES) {
  const linesThisMinute = 6;
  for (let i = 0; i < linesThisMinute; i++) {
    const second = Math.floor((60 / linesThisMinute) * i + rand() * 6);
    const pod = podAt(minute);
    const route = pick(ROUTES);
    const latency = Math.round(42 + (avgMemory(minute) > 75 ? (avgMemory(minute) - 75) * 3.4 : 0) + rand() * 25);
    appLog.push({
      ts: iso(minute, Math.min(59, second)),
      level: "info",
      pod,
      msg: `${route} 200 ${latency}ms`,
    });
  }

  if (minute === minuteOf("14:21")) {
    appLog.push({ ts: iso(minute, 6), level: "info", pod: "-", msg: `deploy: rolling update to v1.8.4 started (commit c41b8ea)` });
  }
  if (minute === minuteOf("14:23")) {
    appLog.push({ ts: iso(minute, 33), level: "info", pod: "-", msg: `deploy: rolling update to v1.8.4 complete, 5/5 pods on revision 47` });
  }

  // GC pressure shows up in the app log before anything user-visible does.
  if (avgMemory(minute) > 68) {
    appLog.push({
      ts: iso(minute, 41),
      level: "warn",
      pod: podAt(minute),
      msg: `gc: major collection took ${Math.round(180 + (avgMemory(minute) - 68) * 12)}ms, heap ${(avgMemory(minute) * MEMORY_LIMIT_MIB / 100 / 1024).toFixed(2)}GB retained after collection`,
    });
  }
  if (avgMemory(minute) > 82) {
    appLog.push({
      ts: iso(minute, 47),
      level: "warn",
      pod: podAt(minute),
      msg: `aggregation: transactionCache size=${Math.round((avgMemory(minute) - 38) * 1840)} entries, oldest=${Math.round((minute - minuteOf("14:23")) * 60)}s`,
    });
  }
}

for (const restart of restarts) {
  const line: LogLine = {
    ts: iso(restart.minute, restart.second),
    level: "fatal",
    pod: restart.pod,
    msg: "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
  };
  appLog.push(line);
  errorLog.push(line);

  for (let i = 0; i < 4; i++) {
    const line: LogLine = {
      ts: iso(restart.minute, Math.min(59, restart.second + 1 + i)),
      level: "error",
      pod: restart.pod,
      msg: `${pick(ROUTES)} 500 - upstream connection reset during request (pod terminating)`,
    };
    appLog.push(line);
    errorLog.push(line);
  }
  for (let i = 0; i < 3; i++) {
    const line: LogLine = {
      ts: iso(restart.minute, Math.min(59, restart.second + 3 + i)),
      level: "error",
      pod: restart.pod,
      msg: "POST /v1/payments 503 - service unavailable, readiness probe not yet passing",
    };
    appLog.push(line);
    errorLog.push(line);
  }
}

// Connection-pool noise: real, elevated, but never actually exhausted. This is
// the bait for the "database connection exhaustion" hypothesis.
for (const minute of MINUTES) {
  if (minute < minuteOf("14:26")) continue;
  const inUse = Math.min(34, 18 + Math.round((avgMemory(minute) - 50) / 3));
  appLog.push({
    ts: iso(minute, 52),
    level: "info",
    pod: podAt(minute),
    msg: `db: pool in_use=${inUse} idle=${40 - inUse} max=40 wait_queue=0 acquire_p99=7ms`,
  });
}

const fmt = (l: LogLine) =>
  `${l.ts} ${l.level.toUpperCase().padEnd(5)} [${SERVICE}${l.pod === "-" ? "" : `/${l.pod}`}] ${l.msg}`;

const byTime = (a: LogLine, b: LogLine) => a.ts.localeCompare(b.ts);

writeFileSync(
  join(OUT, "logs", "payments-api.log"),
  appLog.sort(byTime).map(fmt).join("\n") + "\n",
);
writeFileSync(
  join(OUT, "logs", "payments-errors.log"),
  errorLog.sort(byTime).map(fmt).join("\n") + "\n",
);

// ---------------------------------------------------------------------------
// Incident record
// ---------------------------------------------------------------------------

const declaredAt = minuteOf("14:37");
// The headline numbers on the incident card are read out of the simulation
// rather than hardcoded, so the card always agrees with the metrics the agent
// is about to fetch.
const upToDeclaration = MINUTES.filter((m) => m <= declaredAt);
const headlineErrorRate = Math.max(...upToDeclaration.map(errorRateAt));
const headlineMemory = Math.max(...upToDeclaration.map(peakMemory));

writeFileSync(
  join(OUT, "incidents", "INC-4821.json"),
  JSON.stringify(
    {
      id: "INC-4821",
      number: 4821,
      title: "Payment API Degradation",
      service: SERVICE,
      severity: "SEV-1",
      status: "INVESTIGATING",
      startedAt: iso(minuteOf("14:32")),
      declaredAt: iso(declaredAt),
      symptoms: ["HTTP 500 spike", "memory growth", "pod restarts", "elevated payment failures"],
      affectedSystems: ["payments-api", "settlement-worker (downstream)", "checkout-web (upstream)"],
      metrics: {
        errorRatePercent: headlineErrorRate,
        memoryPercent: headlineMemory,
        podsRestarting: PODS.filter((p) =>
          restarts.some((r) => r.pod === p.name && r.minute <= declaredAt),
        ).length,
        podsTotal: PODS.length,
      },
    },
    null,
    2,
  ) + "\n",
);

// ---------------------------------------------------------------------------
// Assertions — the §16 timeline is the contract these fixtures must satisfy
// ---------------------------------------------------------------------------

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failures.push(`${label}: ${detail}`);
};

check(
  "14:10 v1.8.3 healthy",
  avgMemory(minuteOf("14:10")) < 45 && errorRateAt(minuteOf("14:10")) === 0,
  `memory=${avgMemory(minuteOf("14:10"))}% errors=${errorRateAt(minuteOf("14:10"))}%`,
);
check(
  "14:20 still flat before v1.8.4",
  avgMemory(minuteOf("14:20")) < 45,
  `memory=${avgMemory(minuteOf("14:20"))}%`,
);
check(
  "14:24 memory climbing",
  avgMemory(minuteOf("14:24")) > avgMemory(minuteOf("14:20")) + 5,
  `14:20=${avgMemory(minuteOf("14:20"))}% 14:24=${avgMemory(minuteOf("14:24"))}%`,
);
// Memory checkpoints are against the *peak* pod, not the fleet average: that
// is what an operator's alert fires on, and it's the number on the incident
// card. The average is dragged down by whichever pod restarted most recently.
check(
  "14:27 memory reaches ~70%",
  peakMemory(minuteOf("14:27")) >= 65 && peakMemory(minuteOf("14:27")) <= 80,
  `peak=${peakMemory(minuteOf("14:27"))}%`,
);
check(
  "14:30 first pod restart",
  restarts.length > 0 && restarts[0].minute === minuteOf("14:30"),
  `first restart at ${restarts.length ? hhmm(restarts[0].minute) : "never"}`,
);
check(
  "14:32 HTTP 500s spike",
  errorRateAt(minuteOf("14:32")) > 5 && errorRateAt(minuteOf("14:31")) > errorRateAt(minuteOf("14:29")),
  `errors 14:29=${errorRateAt(minuteOf("14:29"))}% 14:31=${errorRateAt(minuteOf("14:31"))}% 14:32=${errorRateAt(minuteOf("14:32"))}%`,
);
check(
  "14:34 memory reaches ~90%",
  peakMemory(minuteOf("14:34")) >= 88,
  `peak=${peakMemory(minuteOf("14:34"))}%`,
);
check(
  "error rate stays in SEV-1-but-not-total-outage range",
  peakErrorRate >= 12 && peakErrorRate <= 32,
  `peak error rate=${peakErrorRate}%`,
);
check(
  "no two pods are OOM-killed in the same minute",
  new Set(restarts.map((r) => r.minute)).size === restarts.length,
  `${restarts.length} restarts across ${new Set(restarts.map((r) => r.minute)).size} distinct minutes`,
);
check(
  "14:36 multiple OOMKilled events",
  restarts.filter((r) => r.minute <= minuteOf("14:36")).length >= 3,
  `${restarts.filter((r) => r.minute <= minuteOf("14:36")).length} restarts by 14:36`,
);
check(
  "traffic does not spike (the traffic hypothesis must be falsifiable)",
  requestsAt(END) / requestsAt(START) < 1.12,
  `${requestsAt(START)} -> ${requestsAt(END)} rpm (+${(((requestsAt(END) / requestsAt(START)) - 1) * 100).toFixed(1)}%)`,
);
check(
  "db pool never exhausted (the connection hypothesis must be falsifiable)",
  !appLog.some((l) => l.msg.includes("wait_queue=") && !l.msg.includes("wait_queue=0")),
  "a log line reports a non-zero acquire wait queue",
);

console.log("Generated demo-data:");
console.log(`  pods            ${PODS.length}`);
console.log(`  restarts        ${restarts.length} (first ${hhmm(restarts[0].minute)}, last ${hhmm(restarts.at(-1)!.minute)})`);
console.log(`  app log lines   ${appLog.length}`);
console.log(`  error log lines ${errorLog.length}`);
console.log(`  k8s events      ${events.length}`);
console.log("");
console.log("Timeline:");
for (const m of [14 * 60 + 10, 14 * 60 + 21, 14 * 60 + 24, 14 * 60 + 27, 14 * 60 + 30, 14 * 60 + 32, 14 * 60 + 34, 14 * 60 + 36]) {
  console.log(
    `  ${hhmm(m)}  mem avg ${String(avgMemory(m)).padStart(5)}%  peak ${String(peakMemory(m)).padStart(5)}%  errors ${String(errorRateAt(m)).padStart(5)}%  rpm ${requestsAt(m)}`,
  );
}

if (failures.length) {
  console.error("\n✗ Fixture checks failed — demo-data contradicts the spec §16 timeline:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ All §16 timeline checks passed");
