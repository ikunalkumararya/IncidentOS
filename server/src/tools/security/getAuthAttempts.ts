import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DEMO_DATA } from "../../config.js";
import { defineTool } from "../types.js";

interface AttemptPoint {
  t: string;
  legitimate: number;
  malicious: number;
  rateLimited: number;
  reachedBackend: number;
}

interface AuthAttemptsFile {
  service: string;
  endpoint: string;
  unit: string;
  description: string;
  baselineRpm: number;
  points: AttemptPoint[];
}

let cached: AuthAttemptsFile | null = null;
function load(): AuthAttemptsFile {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(join(DEMO_DATA, "security", "auth-attempts.json"), "utf8"),
    ) as AuthAttemptsFile;
  }
  return cached;
}

const hhmm = (iso: string) => iso.slice(11, 16);

const schema = z.object({
  startTime: z.string().optional().describe("HH:MM; only rows at or after this are returned."),
  endTime: z.string().optional().describe("HH:MM; only rows at or before this are returned."),
});

export const getAuthAttempts = defineTool({
  name: "get_auth_attempts",
  description:
    "Fetch the per-minute authentication attempt series for the payments-api token endpoint, split into " +
    "legitimate, malicious, rate-limited and reached-backend counts. Telemetry covers 14:00-14:45.",
  schema,
  run(input) {
    const file = load();
    const rows = file.points.filter((p) => {
      const t = hhmm(p.t);
      if (input.startTime && t < input.startTime) return false;
      if (input.endTime && t > input.endTime) return false;
      return true;
    });

    const lines = rows.map(
      (p) =>
        `${hhmm(p.t)}  legitimate ${p.legitimate}  malicious ${p.malicious}  rateLimited ${p.rateLimited}  reachedBackend ${p.reachedBackend}`,
    );

    const header = [
      `${file.endpoint} (${file.unit})`,
      file.description,
      `pre-campaign baseline: ${file.baselineRpm} rpm`,
    ].join("\n");

    const firstMalicious = file.points.find((p) => p.malicious > 0);
    const peak = file.points.reduce((a, b) => (b.malicious > a.malicious ? b : a), file.points[0]);

    return {
      content: `${header}\n\n${lines.join("\n")}`,
      summary: firstMalicious
        ? `malicious 0 → ${peak.malicious}/min, peak ${hhmm(peak.t)} · ${rows.length} rows`
        : `no malicious traffic in range · ${rows.length} rows`,
    };
  },
});
