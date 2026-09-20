import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DEMO_DATA } from "../../config.js";
import { defineTool } from "../types.js";

interface SecurityEvent {
  timestamp: string;
  severity: "info" | "warning" | "critical";
  control: string;
  title: string;
  detail: string;
}

const schema = z.object({
  control: z
    .enum(["auth", "waf", "detection", "identity"])
    .optional()
    .describe("Filter to events from one control plane."),
});

export const getSecurityEvents = defineTool({
  name: "get_security_events",
  description:
    "Fetch the security control event log for the campaign: authentication, WAF, detection and identity " +
    "events in chronological order, each with a severity and a one-line detail.",
  schema,
  run(input) {
    const { events } = JSON.parse(
      readFileSync(join(DEMO_DATA, "security", "events.json"), "utf8"),
    ) as { events: SecurityEvent[] };

    const filtered = input.control ? events.filter((e) => e.control === input.control) : events;

    const lines = filtered.map(
      (e) => `${e.timestamp} [${e.severity}] ${e.control} · ${e.title} — ${e.detail}`,
    );

    return {
      content: lines.join("\n") || "(no matching events)",
      summary: `${filtered.length} control event(s)`,
    };
  },
});
