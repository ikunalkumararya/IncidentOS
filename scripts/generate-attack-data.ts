/**
 * Generates everything under demo-data/security/ from one simulation of a
 * credential-stuffing campaign against payments-api, on the same clock as the
 * incident fixtures.
 *
 * Two constraints shape the scenario.
 *
 * First, the attack is deliberately *not* the cause of the memory leak. The
 * incident investigation's value is that it discriminates between competing
 * explanations, and a security event that turned out to also explain the OOM
 * kills would collapse the two stories into one.
 *
 * Second, it has to stay low-volume. generate-demo-data.ts asserts that
 * payments traffic never rises more than 12% across the window — that is what
 * makes the "traffic spike" hypothesis falsifiable. Credential stuffing hits
 * /v1/auth/token, which is a different endpoint and a fraction of the request
 * rate, so both things can be true at once. The assertions at the bottom hold
 * that line.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "demo-data", "security");

const DATE = "2026-03-11";
const SERVICE = "payments-api";

/** Deterministic PRNG (mulberry32), seeded apart from the incident data. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(91773);
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
// Campaign shape
// ---------------------------------------------------------------------------

const PROBE_AT = minuteOf("14:05"); // low-rate probing begins
const RAMP_AT = minuteOf("14:14"); // distributed burst starts
const PEAK_AT = minuteOf("14:26"); // maximum attempt rate
const RATELIMIT_AT = minuteOf("14:18"); // WAF rule trips, part-way up the ramp
const BLOCK_AT = minuteOf("14:31"); // source ranges blocked
const CONTAINED_AT = minuteOf("14:38"); // attempt rate back to baseline

/** Baseline legitimate sign-ins per minute for a service this size. */
const BASELINE_AUTH_RPM = 42;

interface Source {
  ip: string;
  asn: string;
  org: string;
  country: string;
  /** Share of total malicious attempts. */
  weight: number;
  /** Minute this source was blocked, if it was. */
  blockedAt?: number;
}

const SOURCES: Source[] = [
  { ip: "185.220.101.47", asn: "AS43350", org: "NForce Entertainment", country: "NL", weight: 0.26 },
  { ip: "45.133.216.18", asn: "AS204428", org: "SS-Net", country: "RO", weight: 0.21 },
  { ip: "103.251.167.92", asn: "AS135377", org: "UCLOUD HK", country: "HK", weight: 0.18 },
  { ip: "194.26.229.174", asn: "AS49505", org: "Selectel", country: "RU", weight: 0.14 },
  { ip: "141.98.11.203", asn: "AS209588", org: "Flyservers", country: "LT", weight: 0.11 },
  { ip: "89.248.165.31", asn: "AS202425", org: "IP Volume", country: "SC", weight: 0.10 },
];

/**
 * Malicious attempts per minute. Ramps from probing to a distributed burst,
 * then collapses once the source ranges are blocked.
 */
function maliciousAt(minute: number): number {
  if (minute < PROBE_AT) return 0;

  if (minute < RAMP_AT) {
    // Low-and-slow credential validation, deliberately under alert thresholds.
    return Math.max(0, Math.round(6 + jitter(2)));
  }

  if (minute <= PEAK_AT) {
    const progress = (minute - RAMP_AT) / (PEAK_AT - RAMP_AT);
    return Math.round(18 + progress * 320 + jitter(14));
  }

  if (minute < BLOCK_AT) {
    // Rate limiting is rejecting a lot of it, but the sources keep trying.
    const decay = (minute - PEAK_AT) / (BLOCK_AT - PEAK_AT);
    return Math.round(338 - decay * 90 + jitter(18));
  }

  if (minute < CONTAINED_AT) {
    const decay = (minute - BLOCK_AT) / (CONTAINED_AT - BLOCK_AT);
    return Math.max(0, Math.round(240 * (1 - decay) + jitter(10)));
  }

  return Math.max(0, Math.round(jitter(2)));
}

/** Legitimate sign-ins carry on throughout, largely unaffected. */
function legitimateAt(minute: number): number {
  return Math.max(0, Math.round(BASELINE_AUTH_RPM + jitter(5)));
}

/** Requests the WAF rejected outright once the rule was active. */
function rateLimitedAt(minute: number, malicious: number): number {
  if (minute < RATELIMIT_AT) return 0;
  const share = minute >= BLOCK_AT ? 0.94 : 0.62;
  return Math.round(malicious * share);
}

// A handful of accounts were reused across breaches elsewhere and do match.
// This is what makes the campaign worth reporting rather than merely noisy.
const COMPROMISED = [
  { account: "ops-runner@northwind.example", at: minuteOf("14:24"), mfa: "challenged", outcome: "blocked" },
  { account: "billing-svc@northwind.example", at: minuteOf("14:27"), mfa: "not_enrolled", outcome: "session_created" },
  { account: "a.okafor@northwind.example", at: minuteOf("14:29"), mfa: "challenged", outcome: "blocked" },
];

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

interface MinuteRow {
  minute: number;
  legitimate: number;
  malicious: number;
  rateLimited: number;
  reachedBackend: number;
  uniqueSources: number;
}

const rows: MinuteRow[] = MINUTES.map((minute) => {
  const malicious = maliciousAt(minute);
  const rateLimited = rateLimitedAt(minute, malicious);
  const legitimate = legitimateAt(minute);
  const active = malicious === 0 ? 0 : minute < RAMP_AT ? 1 : SOURCES.length;
  return {
    minute,
    legitimate,
    malicious,
    rateLimited,
    reachedBackend: legitimate + Math.max(0, malicious - rateLimited),
    uniqueSources: active,
  };
});

const at = (minute: number) => rows.find((r) => r.minute === minute)!;
const totalMalicious = rows.reduce((sum, r) => sum + r.malicious, 0);
const totalRateLimited = rows.reduce((sum, r) => sum + r.rateLimited, 0);
const peakRow = rows.reduce((best, r) => (r.malicious > best.malicious ? r : best), rows[0]);

mkdirSync(OUT, { recursive: true });

writeFileSync(
  join(OUT, "auth-attempts.json"),
  JSON.stringify(
    {
      service: SERVICE,
      endpoint: "/v1/auth/token",
      unit: "attempts_per_minute",
      description:
        "Authentication attempts against the token endpoint, split by classification. " +
        "Malicious attempts are those attributed to the flagged source ranges.",
      baselineRpm: BASELINE_AUTH_RPM,
      points: rows.map((r) => ({
        t: iso(r.minute),
        legitimate: r.legitimate,
        malicious: r.malicious,
        rateLimited: r.rateLimited,
        reachedBackend: r.reachedBackend,
      })),
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(OUT, "sources.json"),
  JSON.stringify(
    {
      service: SERVICE,
      description: "Source addresses attributed to the campaign, ranked by attempt volume.",
      sources: SOURCES.map((s) => ({
        ip: s.ip,
        asn: s.asn,
        org: s.org,
        country: s.country,
        attempts: Math.round(totalMalicious * s.weight),
        firstSeen: iso(s.weight > 0.2 ? PROBE_AT : RAMP_AT),
        lastSeen: iso(CONTAINED_AT),
        blockedAt: iso(BLOCK_AT),
        status: "blocked",
      })),
    },
    null,
    2,
  ) + "\n",
);

interface SecurityEvent {
  timestamp: string;
  severity: "info" | "warning" | "critical";
  control: string;
  title: string;
  detail: string;
}

const events: SecurityEvent[] = [
  {
    timestamp: iso(PROBE_AT, 12),
    severity: "info",
    control: "auth",
    title: "Elevated authentication failure ratio",
    detail: `Failure ratio on /v1/auth/token rose above the 20% baseline from a single source (${SOURCES[0].ip}).`,
  },
  {
    timestamp: iso(RAMP_AT, 5),
    severity: "warning",
    control: "auth",
    title: "Distributed failure pattern",
    detail: `Failures now spread across ${SOURCES.length} source addresses in ${
      new Set(SOURCES.map((s) => s.country)).size
    } countries, each below the per-IP threshold.`,
  },
  {
    timestamp: iso(RATELIMIT_AT, 33),
    severity: "warning",
    control: "waf",
    title: "Rate-limit rule engaged",
    detail: "Rule auth-burst-v3 began rejecting requests to /v1/auth/token above 30/min per source.",
  },
  {
    timestamp: iso(PEAK_AT, 41),
    severity: "critical",
    control: "detection",
    title: "Credential stuffing confirmed",
    detail: `Attempt rate peaked at ${peakRow.malicious}/min. Reused credential pairs matched a known breach corpus.`,
  },
  {
    timestamp: iso(COMPROMISED[1].at, 18),
    severity: "critical",
    control: "identity",
    title: "Valid credentials accepted",
    detail: `${COMPROMISED[1].account} authenticated successfully from a flagged source; the account is not enrolled in MFA.`,
  },
  {
    timestamp: iso(BLOCK_AT, 7),
    severity: "info",
    control: "waf",
    title: "Source ranges blocked",
    detail: `All ${SOURCES.length} attributed ranges added to the edge deny list.`,
  },
  {
    timestamp: iso(CONTAINED_AT, 22),
    severity: "info",
    control: "detection",
    title: "Campaign contained",
    detail: "Attempt rate returned to baseline. One session revoked, one password reset enforced.",
  },
];

writeFileSync(join(OUT, "events.json"), JSON.stringify({ events }, null, 2) + "\n");

writeFileSync(
  join(OUT, "campaign.json"),
  JSON.stringify(
    {
      id: "SEC-2291",
      title: "Credential stuffing against payments-api",
      service: SERVICE,
      severity: "SEV-2",
      status: "CONTAINED",
      technique: "Credential Stuffing",
      mitre: { id: "T1110.004", name: "Brute Force: Credential Stuffing" },
      startedAt: iso(PROBE_AT),
      detectedAt: iso(PEAK_AT, 41),
      containedAt: iso(CONTAINED_AT, 22),
      targetEndpoint: "/v1/auth/token",
      totals: {
        maliciousAttempts: totalMalicious,
        rateLimited: totalRateLimited,
        reachedBackend: totalMalicious - totalRateLimited,
        uniqueSources: SOURCES.length,
        countries: new Set(SOURCES.map((s) => s.country)).size,
        credentialsMatched: COMPROMISED.length,
        sessionsCreated: COMPROMISED.filter((c) => c.outcome === "session_created").length,
      },
      peak: { at: iso(peakRow.minute), attemptsPerMinute: peakRow.malicious },
      compromised: COMPROMISED.map((c) => ({
        account: c.account,
        at: iso(c.at),
        mfa: c.mfa,
        outcome: c.outcome,
      })),
      // Stated explicitly because it is the question anyone looking at both
      // tabs will ask, and the data supports the answer.
      relatedIncident: {
        id: "INC-4821",
        relationship: "unrelated",
        rationale:
          "The campaign targets /v1/auth/token and never raised payments throughput more than a few percent. " +
          "The memory growth in INC-4821 begins at 14:21 with the v1.8.4 rollout, six minutes before this " +
          "campaign peaks, and continues on pods that served no attacker traffic.",
      },
      markers: [
        { t: hhmm(PROBE_AT), label: "probing" },
        { t: hhmm(RAMP_AT), label: "distributed ramp" },
        { t: hhmm(RATELIMIT_AT), label: "rate limit" },
        { t: hhmm(BLOCK_AT), label: "ranges blocked" },
        { t: hhmm(CONTAINED_AT), label: "contained" },
      ],
    },
    null,
    2,
  ) + "\n",
);

// ---------------------------------------------------------------------------
// Consistency checks
// ---------------------------------------------------------------------------

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failures.push(`${label}: ${detail}`);
};

check("quiet before probing starts", at(START).malicious === 0, `${at(START).malicious} at ${hhmm(START)}`);
check(
  "probing stays under the per-IP alert threshold",
  at(minuteOf("14:10")).malicious < 30,
  `${at(minuteOf("14:10")).malicious}/min at 14:10`,
);
check(
  "campaign peaks at 14:26",
  peakRow.minute === PEAK_AT,
  `peak at ${hhmm(peakRow.minute)} (${peakRow.malicious}/min)`,
);
check(
  "rate limiting removes most of the burst",
  totalRateLimited / totalMalicious > 0.5,
  `${((totalRateLimited / totalMalicious) * 100).toFixed(1)}% rate limited`,
);
check(
  "contained by 14:38",
  at(CONTAINED_AT).malicious < 20 && at(END).malicious < 10,
  `${at(CONTAINED_AT).malicious}/min at 14:38, ${at(END).malicious}/min at ${hhmm(END)}`,
);
// The load this adds must stay small enough that the payments-api request
// rate still looks flat, or it would resurrect the traffic-spike hypothesis
// that generate-demo-data.ts is careful to keep falsifiable.
const worstAddedLoad = Math.max(...rows.map((r) => r.reachedBackend - r.legitimate));
// payments-api runs at a 1240 rpm baseline and generate-demo-data.ts asserts
// the rate never climbs more than 12% (~149 rpm) across the window. Attack
// traffic that reached the backend in that volume would make the traffic-spike
// hypothesis unfalsifiable, so it is held comfortably below that margin.
check(
  "attack never adds enough backend load to explain the incident",
  worstAddedLoad < 140,
  `worst added ${worstAddedLoad} req/min reaching the backend (12% of baseline is ~149)`,
);
check(
  "attack peak does not coincide with the leak onset at 14:21",
  Math.abs(peakRow.minute - minuteOf("14:21")) >= 4,
  `peak ${hhmm(peakRow.minute)} vs leak onset 14:21`,
);
check(
  "legitimate sign-ins are never blocked out",
  rows.every((r) => r.legitimate > 25),
  `min legitimate ${Math.min(...rows.map((r) => r.legitimate))}/min`,
);

console.log("Generated demo-data/security:");
console.log(`  malicious attempts  ${totalMalicious.toLocaleString()}`);
console.log(`  rate limited        ${totalRateLimited.toLocaleString()} (${((totalRateLimited / totalMalicious) * 100).toFixed(1)}%)`);
console.log(`  reached backend     ${(totalMalicious - totalRateLimited).toLocaleString()}`);
console.log(`  sources             ${SOURCES.length} across ${new Set(SOURCES.map((s) => s.country)).size} countries`);
console.log(`  peak                ${peakRow.malicious}/min at ${hhmm(peakRow.minute)}`);
console.log("");
console.log("Timeline:");
for (const m of [PROBE_AT, RAMP_AT, RATELIMIT_AT, PEAK_AT, BLOCK_AT, CONTAINED_AT]) {
  const r = at(m);
  console.log(
    `  ${hhmm(m)}  malicious ${String(r.malicious).padStart(4)}/min  limited ${String(r.rateLimited).padStart(4)}  legit ${String(r.legitimate).padStart(3)}`,
  );
}

if (failures.length) {
  console.error("\n✗ Security fixture checks failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ All security fixture checks passed");
