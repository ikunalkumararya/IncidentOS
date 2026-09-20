import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import "../server/src/config.js";

const [kind, file] = process.argv.slice(2);
if (!["incidents", "logs"].includes(kind) || !file) throw new Error("Usage: pnpm webhook:send incidents|logs payload.json");
const secret = process.env.INCIDENT_WEBHOOK_SECRET;
if (!secret) throw new Error("Set INCIDENT_WEBHOOK_SECRET in .env");
const raw = readFileSync(file, "utf8");
JSON.parse(raw);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", secret).update(timestamp + ".").update(raw).digest("hex");
const base = process.env.INCIDENT_API_URL || `http://localhost:${process.env.PORT || 4000}`;
const response = await fetch(`${base}/api/webhooks/${kind}`, {
  method: "POST", body: raw,
  headers: { "content-type": "application/json", "x-incident-timestamp": timestamp, "x-incident-signature": `sha256=${signature}` },
});
console.log(response.status, await response.text());
if (!response.ok) process.exitCode = 1;
