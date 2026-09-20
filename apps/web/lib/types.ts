/**
 * The event contract is owned by the server. These are type-only imports, so
 * they are erased at build time and the web app takes on no runtime dependency
 * on the server package — but the two can never drift apart.
 */
export type { InvestigationEvent, Phase, TimedEvent } from "@server/events";
export type { Incident } from "@server/incidents/index";
export type { TimelineMarker, TimelinePoint } from "@server/timeline";
