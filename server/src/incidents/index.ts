import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DATA } from "../config.js";

export interface Incident {
  id: string;
  number: number;
  title: string;
  service: string;
  severity: string;
  status: string;
  startedAt: string;
  declaredAt: string;
  symptoms: string[];
  affectedSystems: string[];
  metrics: {
    errorRatePercent: number;
    memoryPercent: number;
    podsRestarting: number;
    podsTotal: number;
  };
}

export const ACTIVE_INCIDENT_ID = "INC-4821";

export function loadIncident(id: string = ACTIVE_INCIDENT_ID): Incident {
  // The id indexes a fixed set of bundled fixtures; reject anything that could
  // walk out of the incidents directory.
  if (!/^INC-\d{1,6}$/.test(id)) {
    throw new Error(`invalid incident id: ${id}`);
  }
  return JSON.parse(readFileSync(join(DEMO_DATA, "incidents", `${id}.json`), "utf8")) as Incident;
}
