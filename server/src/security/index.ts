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

const read = <T>(name: string): T => JSON.parse(readFileSync(join(SECURITY, `${name}.json`), "utf8")) as T;

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
} | null = null;

export function buildAttackAnalysis() {
  if (cached) return cached;

  const campaign = read<AttackCampaign>("campaign");
  const attempts = read<{ points: AttackPoint[] }>("auth-attempts");
  const sources = read<{ sources: AttackSource[] }>("sources");
  const events = read<{ events: SecurityEvent[] }>("events");

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
  };
  return cached;
}
