"use client";

import { SmallMultiples, type SmallMultiplesSeries } from "./SmallMultiples";
import type { TimelineMarker, TimelinePoint } from "@/lib/types";

/**
 * Two small multiples sharing one x-axis.
 *
 * Peak memory and error rate are different measures, so they get one panel
 * each with its own y-scale rather than being forced onto a shared axis —
 * and each panel carries a single series, so the panel title is the label and
 * no legend is needed.
 */
const SERIES: SmallMultiplesSeries<TimelinePoint>[] = [
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

export function IncidentChart({
  points,
  markers,
  visibleCount,
}: {
  points: TimelinePoint[];
  markers: TimelineMarker[];
  visibleCount?: number;
}) {
  return (
    <SmallMultiples
      series={SERIES}
      points={points}
      markers={markers}
      visibleCount={visibleCount}
      panelHeight={74}
      ariaLabel="Peak pod memory and HTTP 5xx rate between 14:00 and 14:45"
    />
  );
}
