import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DATA } from "./config.js";

interface Point {
  t: string;
  value: number;
}

const metric = (name: string) =>
  JSON.parse(readFileSync(join(DEMO_DATA, "metrics", `${name}.json`), "utf8")) as {
    points: Point[];
    peak?: Point[];
  };

export interface TimelinePoint {
  /** HH:MM, the only precision the chart shows. */
  t: string;
  memoryPeak: number;
  errorRate: number;
}

export interface TimelineMarker {
  t: string;
  label: string;
}

let cached: { points: TimelinePoint[]; markers: TimelineMarker[] } | null = null;

export function buildTimeline() {
  if (cached) return cached;

  const memory = metric("memory");
  const errors = metric("errors");
  const errorByTime = new Map(errors.points.map((p) => [p.t, p.value]));

  // The card charts peak memory rather than the fleet average: the average is
  // pulled down every time a pod restarts, which hides the very trend the
  // chart exists to show.
  const peak = memory.peak ?? memory.points;

  const points: TimelinePoint[] = peak.map((p) => ({
    t: p.t.slice(11, 16),
    memoryPeak: p.value,
    errorRate: errorByTime.get(p.t) ?? 0,
  }));

  cached = {
    points,
    markers: [
      { t: "14:10", label: "v1.8.3" },
      { t: "14:21", label: "v1.8.4 deploy" },
      { t: "14:30", label: "first OOM kill" },
      { t: "14:37", label: "declared" },
    ],
  };
  return cached;
}
