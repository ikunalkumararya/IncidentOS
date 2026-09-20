import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DEMO_DATA } from "../../config.js";
import { defineTool } from "../types.js";

interface AttackSource {
  ip: string;
  asn: string;
  org: string;
  country: string;
  attempts: number;
  firstSeen: string;
  lastSeen: string;
  blockedAt: string;
  status: string;
}

const schema = z.object({});

export const getAttackSources = defineTool({
  name: "get_attack_sources",
  description:
    "Fetch the source addresses attributed to the campaign: IP, ASN, org, country, attempt volume, " +
    "when each was first/last seen and blocked, and its current status. Also computes each source's " +
    "average attempts per active minute, which is how you see a source individually staying under a " +
    "per-IP rate limit while the campaign as a whole is not.",
  schema,
  run() {
    const { sources } = JSON.parse(
      readFileSync(join(DEMO_DATA, "security", "sources.json"), "utf8"),
    ) as { sources: AttackSource[] };

    const rows = sources.map((s) => {
      const minutes = Math.max(
        1,
        Math.round((Date.parse(s.lastSeen) - Date.parse(s.firstSeen)) / 60_000),
      );
      const perMinute = (s.attempts / minutes).toFixed(1);
      return (
        `${s.ip}  asn=${s.asn}  org=${s.org}  country=${s.country}  attempts=${s.attempts}  ` +
        `firstSeen=${s.firstSeen.slice(11, 16)}  lastSeen=${s.lastSeen.slice(11, 16)}  ` +
        `blockedAt=${s.blockedAt.slice(11, 16)}  status=${s.status}  ≈${perMinute}/min over ${minutes}min`
      );
    });

    const countries = new Set(sources.map((s) => s.country)).size;
    const totalAttempts = sources.reduce((sum, s) => sum + s.attempts, 0);

    return {
      content: rows.join("\n"),
      summary: `${sources.length} sources · ${countries} countries · ${totalAttempts.toLocaleString()} attempts`,
    };
  },
});
