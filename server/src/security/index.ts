import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DATA } from "../config.js";

const SECURITY = join(DEMO_DATA, "security");

export interface AttackSource {
  ip: string;
  asn: string;
  org: string;
  country: string;
  attempts: number;
  firstSeen: string;
  lastSeen: string;
  blockedAt: string;
  status: string;
}

export interface SecurityEvent {
  timestamp: string;
  severity: "info" | "warning" | "critical";
  control: string;
  title: string;
  detail: string;
}

export interface AttackPoint {
  t: string;
  legitimate: number;
  malicious: number;
  rateLimited: number;
  reachedBackend: number;
}

export interface AttackCampaign {
  id: string;
  title: string;
  service: string;
  severity: string;
  status: string;
  technique: string;
  mitre: { id: string; name: string };
  startedAt: string;
  detectedAt: string;
  containedAt: string;
  targetEndpoint: string;
  totals: Record<string, number>;
  peak: { at: string; attemptsPerMinute: number };
  compromised: { account: string; at: string; mfa: string; outcome: string }[];
  relatedIncident: { id: string; relationship: string; rationale: string };
  markers: { t: string; label: string }[];
}

export interface HealthPoint {
  t: string;
  cpu: number | null;
  memoryPeak: number | null;
  errorRate: number | null;
}

export interface HealthMarker {
  t: string;
  label: string;
}

const read = <T>(name: string): T => JSON.parse(readFileSync(join(SECURITY, `${name}.json`), "utf8")) as T;

interface MetricPoint {
  t: string;
  value: number;
}
interface MetricFile {
  points: MetricPoint[];
  peak?: MetricPoint[];
}

const readMetric = (name: string): MetricFile =>
  JSON.parse(readFileSync(join(DEMO_DATA, "metrics", `${name}.json`), "utf8")) as MetricFile;

interface K8sEvent {
  timestamp: string;
  reason: string;
  object: string;
}

/**
 * The live health strip on the attack tab: the same cpu/memory/error series
 * the incident timeline uses, joined by ISO timestamp so the two tabs can be
 * read against each other, plus the OOM markers worth annotating on it.
 */
function buildHealth(): { health: HealthPoint[]; healthMarkers: HealthMarker[] } {
  const cpu = readMetric("cpu");
  const memory = readMetric("memory");
  const errors = readMetric("errors");

  const memoryPeakByTime = new Map((memory.peak ?? memory.points).map((p) => [p.t, p.value]));
  const cpuByTime = new Map(cpu.points.map((p) => [p.t, p.value]));
  const errorByTime = new Map(errors.points.map((p) => [p.t, p.value]));

  const allTimes = new Set([...cpuByTime.keys(), ...memoryPeakByTime.keys(), ...errorByTime.keys()]);
  const health = [...allTimes]
    .sort()
    .map((t) => ({
      t: t.slice(11, 16),
      cpu: cpuByTime.get(t) ?? null,
      memoryPeak: memoryPeakByTime.get(t) ?? null,
      errorRate: errorByTime.get(t) ?? null,
    }));

  const { events } = JSON.parse(
    readFileSync(join(DEMO_DATA, "kubernetes", "events.json"), "utf8"),
  ) as { events: K8sEvent[] };
  const seenMinutes = new Set<string>();
  const healthMarkers: HealthMarker[] = [];
  for (const event of events) {
    if (event.reason !== "OOMKilling" && event.reason !== "OOMKilled") continue;
    const minute = event.timestamp.slice(11, 16);
    if (seenMinutes.has(minute)) continue;
    seenMinutes.add(minute);
    healthMarkers.push({ t: minute, label: `OOM kill ${event.object.replace(/^pod\//, "")}` });
  }

  return { health, healthMarkers };
}

/**
 * Fixtures are immutable, so they are parsed once. Everything the attack tab
 * renders comes from one payload — the series, the sources, the event log and
 * the campaign summary are all views of the same simulated campaign, and
 * splitting them across requests would only let them arrive out of step.
 */
let cached: {
  campaign: AttackCampaign;
  points: { t: string; legitimate: number; malicious: number; rateLimited: number; reachedBackend: number }[];
  sources: AttackSource[];
  events: SecurityEvent[];
  health: HealthPoint[];
  healthMarkers: HealthMarker[];
} | null = null;

export function buildAttackAnalysis() {
  if (cached) return cached;

  const campaign = read<AttackCampaign>("campaign");
  const attempts = read<{ points: AttackPoint[] }>("auth-attempts");
  const sources = read<{ sources: AttackSource[] }>("sources");
  const events = read<{ events: SecurityEvent[] }>("events");
  const { health, healthMarkers } = buildHealth();

  cached = {
    campaign,
    // HH:MM is the only precision the chart shows, matching the incident
    // timeline so the two tabs can be read against each other.
    points: attempts.points.map((p) => ({
      t: p.t.slice(11, 16),
      legitimate: p.legitimate,
      malicious: p.malicious,
      rateLimited: p.rateLimited,
      reachedBackend: p.reachedBackend,
    })),
    sources: sources.sources,
    events: events.events,
    health,
    healthMarkers,
  };
  return cached;
}
