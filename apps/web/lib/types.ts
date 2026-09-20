/**
 * The event contract is owned by the server. These are type-only imports, so
 * they are erased at build time and the web app takes on no runtime dependency
 * on the server package — but the two can never drift apart.
 */
export type { InvestigationEvent, Phase, TimedEvent, AttackSimResult } from "@server/events";
export type { Incident } from "@server/incidents/index";
export type { TimelineMarker, TimelinePoint } from "@server/timeline";
export type {
  AttackCampaign,
  AttackSource,
  SecurityEvent,
} from "@server/security/index";

/** The single payload behind the attack-analysis tab. */
export interface AttackAnalysis {
  campaign: import("@server/security/index").AttackCampaign;
  points: {
    t: string;
    legitimate: number;
    malicious: number;
    rateLimited: number;
    reachedBackend: number;
  }[];
  sources: import("@server/security/index").AttackSource[];
  events: import("@server/security/index").SecurityEvent[];
  health: import("@server/security/index").HealthPoint[];
  healthMarkers: import("@server/security/index").HealthMarker[];
}
