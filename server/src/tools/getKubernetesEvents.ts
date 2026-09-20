import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DEMO_DATA } from "../config.js";
import { defineTool } from "./types.js";

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(join(DEMO_DATA, "kubernetes", `${name}.json`), "utf8")) as T;

interface K8sEvent {
  timestamp: string;
  type: string;
  reason: string;
  object: string;
  message: string;
  count: number;
}

const schema = z.object({
  service: z.string().optional().describe("Filter to a service, e.g. payments-api."),
  pod: z.string().optional().describe("Filter to a single pod name or name fragment."),
  reason: z
    .string()
    .optional()
    .describe("Filter by event reason, e.g. OOMKilling, BackOff, Started, ScalingReplicaSet."),
  includePods: z
    .boolean()
    .default(true)
    .describe("Include current pod status (restart counts, last termination reason) alongside the events."),
});

export const getKubernetesEvents = defineTool({
  name: "get_kubernetes_events",
  description:
    "Fetch Kubernetes events and pod status for the payments namespace. Events cover the rolling update, " +
    "container restarts and OOM kills. Pod status carries restart counts and the last termination reason " +
    "and exit code, which is how you tell an OOM kill (137) from a crash or an eviction.",
  schema,
  run(input) {
    const { events } = read<{ events: K8sEvent[] }>("events");
    const { pods } = read<{ pods: any[] }>("pods");
    const deployments = read<{ deployments: any[] }>("deployments");

    const filtered = events.filter((e) => {
      if (input.pod && !e.object.includes(input.pod)) return false;
      if (input.reason && e.reason.toLowerCase() !== input.reason.toLowerCase()) return false;
      if (input.service && !e.object.includes(input.service)) return false;
      return true;
    });

    const lines = filtered.map(
      (e) =>
        `${e.timestamp.slice(11, 19)}  ${e.type.padEnd(7)} ${e.reason.padEnd(18)} ${e.object.padEnd(46)} ${e.message}` +
        (e.count > 1 ? ` (x${e.count})` : ""),
    );

    const parts = [`${filtered.length} event(s)`, "", lines.join("\n")];

    if (input.includePods) {
      const podLines = pods
        .filter((p) => !input.pod || p.name.includes(input.pod))
        .map(
          (p) =>
            `${p.name}  ready=${p.ready}  restarts=${p.restarts}  lastTermination=${p.lastTerminationReason ?? "none"}` +
            `${p.lastTerminationExitCode ? ` exit=${p.lastTerminationExitCode}` : ""}  memLimit=${p.resources.limits.memory}`,
        );
      parts.push("", "pods:", podLines.join("\n"));

      const d = deployments.deployments[0];
      parts.push(
        "",
        `deployment ${d.name}: revision ${d.revision}, image ${d.image}, ` +
          `replicas ${d.replicas.ready}/${d.replicas.desired} ready`,
        ...d.conditions.map((c: any) => `  condition ${c.type}=${c.status} (${c.reason})`),
      );
    }

    const oomCount = filtered.filter((e) => e.reason === "OOMKilling").length;

    return {
      content: parts.join("\n"),
      summary: `${filtered.length} k8s event(s)${oomCount ? `, ${oomCount} OOMKilling` : ""}`,
    };
  },
});
