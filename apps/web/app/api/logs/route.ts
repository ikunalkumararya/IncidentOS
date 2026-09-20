import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { postSignedWebhook } from "@/lib/intakeWebhook";
import { take } from "@/lib/rateLimit";

/**
 * Triggers a log batch from the demo storefront, the way a log collector would
 * deliver one.
 *
 * The caller supplies nothing. The batch below is written here, on the server,
 * and the browser only decides *when* it is sent. That is deliberate: this
 * endpoint is public and unauthenticated, and a batch that reaches
 * /api/webhooks/logs can raise a critical incident on its own and have its
 * contents fed to a model as evidence. Letting a stranger dictate those lines
 * would be letting them forge the evidence an investigation then reasons over.
 *
 * Whether an incident actually results is not decided here either — the batch
 * goes to the real detector (detectAnomaly in server/src/incidents/intake.ts),
 * which applies its own thresholds. This route can be wrong about what it is
 * sending; it cannot fake the outcome.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tighter than reports: one press raises a SEV-worthy incident by itself. */
const PER_IP_LIMIT = 3;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_LIMIT = 20;
const GLOBAL_WINDOW_MS = 10 * 60 * 1000;

const SERVICE = "payments-api";

/**
 * A payments-api degradation, told in the order it would actually arrive:
 * latency creeping, memory climbing, captures timing out, then the pod dying.
 * The offsets keep the whole batch inside the five-minute window the detector
 * requires of a monitoring sample.
 */
const TEMPLATE: { secondsAgo: number; level: string; message: string }[] = [
  { secondsAgo: 240, level: "info", message: "capture latency p99 1.9s over 60s window" },
  { secondsAgo: 215, level: "warn", message: "container memory usage 71% of 2Gi limit" },
  { secondsAgo: 190, level: "warn", message: "capture latency p99 4.8s over 60s window" },
  { secondsAgo: 165, level: "error", message: "payment capture failed: context deadline exceeded" },
  { secondsAgo: 140, level: "error", message: "payment capture failed: context deadline exceeded" },
  { secondsAgo: 120, level: "warn", message: "container memory usage 88% of 2Gi limit" },
  { secondsAgo: 100, level: "error", message: "checkout session abandoned after gateway timeout" },
  { secondsAgo: 80, level: "error", message: "OOMKilled: container payments-api exceeded memory limit" },
  { secondsAgo: 60, level: "error", message: "pod payments-api-7d4f9c-x2m entered CrashLoopBackOff" },
  { secondsAgo: 45, level: "error", message: "upstream connect error: no healthy backends" },
  { secondsAgo: 30, level: "error", message: "payment capture failed: context deadline exceeded" },
  { secondsAgo: 15, level: "fatal", message: "FATAL: worker exited after repeated restarts" },
  { secondsAgo: 5, level: "info", message: "readiness probe failing for 2/3 pods" },
];

function tooMany(retryAfterSeconds: number) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return NextResponse.json(
    { error: `Already sent recently. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

export async function POST(request: Request) {
  const secret = process.env.INCIDENT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Log intake is not configured on this deployment." }, { status: 503 });
  }

  const forwarded = request.headers.get("x-forwarded-for");
  const key = forwarded?.split(",")[0]?.trim() || "direct";
  const perIp = take(`logs:${key}`, PER_IP_LIMIT, PER_IP_WINDOW_MS);
  if (!perIp.ok) return tooMany(perIp.retryAfterSeconds);
  const global = take("logs:__global__", GLOBAL_LIMIT, GLOBAL_WINDOW_MS);
  if (!global.ok) return tooMany(global.retryAfterSeconds);

  const now = Date.now();
  const payload = JSON.stringify({
    // Minted per press, so each batch is a fresh detection rather than a
    // duplicate of the last one.
    eventId: randomUUID(),
    service: SERVICE,
    entries: TEMPLATE.map((entry) => ({
      timestamp: new Date(now - entry.secondsAgo * 1000).toISOString(),
      level: entry.level,
      message: entry.message,
    })),
  });

  let upstream: Response;
  try {
    upstream = await postSignedWebhook("logs", payload, secret);
  } catch {
    return NextResponse.json(
      { error: "The incident service is unreachable. Please try again shortly." },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    console.error(`Log intake rejected a signed batch with ${upstream.status}.`);
    return NextResponse.json({ error: "That log batch could not be delivered." }, { status: 502 });
  }

  // The detector decides; this route reports what it decided rather than
  // assuming an incident was raised.
  const body = (await upstream.json().catch(() => ({}))) as { detected?: boolean };
  return NextResponse.json({ detected: Boolean(body.detected), service: SERVICE, entries: TEMPLATE.length });
}
