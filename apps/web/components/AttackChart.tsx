"use client";

import { SmallMultiples, type SmallMultiplesSeries } from "./SmallMultiples";

/**
 * Three small multiples sharing one x-axis, built to the same spec as
 * IncidentChart so the two tabs read as one system.
 *
 * Attempts, blocked requests and legitimate sign-ins are different measures,
 * so each gets a panel with its own y-scale rather than being forced onto a
 * shared axis. One series per panel means the panel title is the label and no
 * legend is needed — which is also what lets the palette's colour-vision
 * separation sit in the acceptable band, since colour is never the only thing
 * distinguishing a series.
 *
 * The pairing is the point: "reaching the backend" against "attempts" is the
 * WAF's effect, and "legitimate sign-ins" staying flat is the evidence that
 * the mitigation did not lock real users out.
 */
export interface AttackPoint {
  t: string;
  legitimate: number;
  malicious: number;
  rateLimited: number;
  reachedBackend: number;
}

export const AUTH_SERIES: SmallMultiplesSeries<AttackPoint>[] = [
  {
    key: "malicious",
    title: "Malicious attempts",
    unit: "per minute",
    color: "var(--color-series-errors)",
  },
  {
    key: "reachedBackend",
    title: "Reaching the backend",
    unit: "per minute, after rate limiting",
    color: "var(--color-series-blocked)",
  },
  {
    key: "legitimate",
    title: "Legitimate sign-ins",
    unit: "per minute",
    color: "var(--color-series-memory)",
  },
];

export function AttackChart({
  points,
  markers,
  visibleCount,
}: {
  points: AttackPoint[];
  markers: { t: string; label: string }[];
  visibleCount?: number;
}) {
  return (
    <SmallMultiples
      series={AUTH_SERIES}
      points={points}
      markers={markers}
      visibleCount={visibleCount}
      panelHeight={64}
      ariaLabel="Authentication attempts, requests reaching the backend, and legitimate sign-ins between 14:00 and 14:45"
    />
  );
}
