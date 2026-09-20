"use client";

import { AUTH_SERIES, type AttackPoint } from "./AttackChart";
import { SmallMultiples, type SmallMultiplesSeries } from "./SmallMultiples";
import type { InvestigationState } from "@/lib/useInvestigation";
import { visibleCount } from "@/lib/playback";
import type { HealthPoint, HealthMarker } from "@server/security/index";

const SYSTEM_SERIES: SmallMultiplesSeries<HealthPoint>[] = [
  {
    key: "cpu",
    title: "CPU",
    unit: "% of request",
    color: "var(--color-series-blocked)",
    max: 100,
    formatValue: (v) => `${v}%`,
  },
  {
    key: "memoryPeak",
    title: "Peak pod memory",
    unit: "% of 2Gi limit",
    color: "var(--color-series-memory)",
    max: 100,
    formatValue: (v) => `${v}%`,
  },
  {
    key: "errorRate",
    title: "HTTP 5xx",
    unit: "% of requests",
    color: "var(--color-series-errors)",
    max: null,
    formatValue: (v) => `${v}%`,
  },
];

/**
 * The attack tab's "live health metrics" block: the auth-attempt series
 * (what the attack looked like) stacked over the same cpu/memory/error
 * series the incident tab uses (what the service looked like), so the two
 * stories can be read against each other. Each block gets its own playback
 * cursor, computed from the same phase/tool-count state, so both reveal in
 * lockstep even though the two fixtures have a different number of points.
 */
export function LiveHealthChart({
  points,
  markers,
  health,
  healthMarkers,
  playback,
}: {
  points: AttackPoint[];
  markers: { t: string; label: string }[];
  health: HealthPoint[];
  healthMarkers: HealthMarker[];
  playback: Pick<InvestigationState, "phase" | "phaseToolCount" | "status">;
}) {
  return (
    <div className="space-y-6">
      <SmallMultiples
        series={AUTH_SERIES}
        points={points}
        markers={markers}
        visibleCount={visibleCount(playback, points.length)}
        panelHeight={64}
        ariaLabel="Authentication attempts, requests reaching the backend, and legitimate sign-ins during the campaign"
      />
      <SmallMultiples
        series={SYSTEM_SERIES}
        points={health}
        markers={healthMarkers}
        visibleCount={visibleCount(playback, health.length)}
        panelHeight={64}
        ariaLabel="CPU, peak pod memory and HTTP 5xx rate during the campaign window"
      />
    </div>
  );
}
