import { getSettlementQueueDepth } from "./transactions.js";

export interface HealthReport {
  status: "ok" | "degraded";
  version: string;
  uptimeSeconds: number;
  settlementQueueDepth: number;
  checks: Record<string, "pass" | "fail">;
}

export const VERSION = "v1.8.4";

/** Queue depth above which readiness reports degraded. */
export const QUEUE_DEPTH_WARNING = 250_000;

/**
 * Readiness detail, expanded in v1.8.3.
 *
 * Note that the settlement queue depth is reported but its threshold is set so
 * high that it never fires before the container hits its memory limit.
 */
export function buildHealthReport(uptimeSeconds: number, dbReachable: boolean): HealthReport {
  const queueDepth = getSettlementQueueDepth();
  const checks: Record<string, "pass" | "fail"> = {
    database: dbReachable ? "pass" : "fail",
    settlementQueue: queueDepth < QUEUE_DEPTH_WARNING ? "pass" : "fail",
  };

  const status = Object.values(checks).every((c) => c === "pass") ? "ok" : "degraded";

  return { status, version: VERSION, uptimeSeconds, settlementQueueDepth: queueDepth, checks };
}
