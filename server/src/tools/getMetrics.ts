import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DEMO_DATA } from "../config.js";
import { defineTool } from "./types.js";

type Point = { t: string; value: number };
interface MetricFile {
  service: string;
  metric: string;
  unit: string;
  description: string;
  points: Point[];
  peak?: Point[];
  byPod?: Record<string, Point[]>;
  baselineRpm?: number;
  limitMiB?: number;
}

const cache = new Map<string, MetricFile>();
function load(metric: string): MetricFile {
  let file = cache.get(metric);
  if (!file) {
    file = JSON.parse(readFileSync(join(DEMO_DATA, "metrics", `${metric}.json`), "utf8")) as MetricFile;
    cache.set(metric, file);
  }
  return file;
}

const hhmm = (iso: string) => iso.slice(11, 16);

const schema = z.object({
  service: z.string().describe("Service name, e.g. payments-api."),
  metric: z
    .enum(["memory", "cpu", "requests", "errors"])
    .describe(
      "memory = container working set as a percent of the limit; cpu = percent of CPU request; " +
        "requests = inbound requests per minute; errors = percent of requests answered with 5xx.",
    ),
  perPod: z
    .boolean()
    .default(false)
    .describe("For the memory metric, also break the series down per pod. Ignored for other metrics."),
});

export const getMetrics = defineTool({
  name: "get_metrics",
  description:
    "Fetch a time series for payments-api between 14:00 and 14:45. Returns one sample per minute. " +
    "The memory series also carries a per-pod breakdown, which is where a sawtooth from restarts shows up — " +
    "the fleet average can look flat while individual pods are climbing into their limit.",
  schema,
  run(input) {
    const file = load(input.metric);

    const rows = file.points.map((p) => {
      const peak = file.peak?.find((q) => q.t === p.t);
      return peak ? `${hhmm(p.t)}  avg ${p.value}  peak ${peak.value}` : `${hhmm(p.t)}  ${p.value}`;
    });

    const parts = [
      `${file.metric} for ${file.service} (${file.unit})`,
      file.description,
      file.limitMiB ? `container memory limit: ${file.limitMiB}Mi` : "",
      file.baselineRpm ? `pre-incident baseline: ${file.baselineRpm} rpm` : "",
      "",
      rows.join("\n"),
    ].filter(Boolean);

    if (input.perPod && file.byPod) {
      parts.push("", "per-pod breakdown:");
      for (const [pod, series] of Object.entries(file.byPod)) {
        parts.push(`\n${pod}`, series.map((p) => `  ${hhmm(p.t)}  ${p.value}`).join("\n"));
      }
    }

    const values = file.points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
      content: parts.join("\n"),
      summary: `${input.metric}: ${min} → ${max} ${file.unit} over the window`,
    };
  },
});
