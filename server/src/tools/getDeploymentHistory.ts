import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DEMO_DATA } from "../config.js";
import { defineTool } from "./types.js";

interface Deployment {
  version: string;
  deployedAt: string;
  deployedBy: string;
  commit: string;
  message: string;
  status: string;
  changedFiles: string[];
  rolloutDurationSeconds?: number;
  notes?: string;
}

const schema = z.object({
  service: z.string().describe("Service name, e.g. payments-api."),
  limit: z.number().int().min(1).max(20).default(6).describe("How many recent deployments to return."),
});

export const getDeploymentHistory = defineTool({
  name: "get_deployment_history",
  description:
    "Fetch the recent deployment history for a service: version, time, commit, commit message, rollout " +
    "status and the files each release changed. The changed-file list is the bridge from a suspicious " +
    "release to the source files worth reading.",
  schema,
  run(input) {
    const history = JSON.parse(
      readFileSync(join(DEMO_DATA, "deployments", "history.json"), "utf8"),
    ) as { service: string; deployments: Deployment[]; current: string; previousStable: string };

    const recent = history.deployments.slice(-input.limit);

    const blocks = recent.map((d) =>
      [
        `${d.version}  ${d.deployedAt.slice(11, 16)}  ${d.status.toUpperCase()}`,
        `  commit   ${d.commit} — ${d.message}`,
        `  by       ${d.deployedBy}`,
        d.rolloutDurationSeconds ? `  rollout  ${d.rolloutDurationSeconds}s` : "",
        `  changed  ${d.changedFiles.join(", ")}`,
        d.notes ? `  notes    ${d.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    return {
      content: [
        `deployment history for ${history.service}`,
        `current: ${history.current}   last known good: ${history.previousStable}`,
        "",
        blocks.join("\n\n"),
      ].join("\n"),
      summary: `${recent.length} deployments; current ${history.current} (${
        recent.find((d) => d.version === history.current)?.status ?? "unknown"
      })`,
    };
  },
});
