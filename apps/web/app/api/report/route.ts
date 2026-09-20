import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { postSignedWebhook } from "@/lib/intakeWebhook";
import { take } from "@/lib/rateLimit";

/**
 * The signing proxy behind the public report form.
 *
 * The intake webhook on the API server authenticates callers with a shared
 * HMAC secret (server/src/incidents/intake.ts). A browser cannot hold that
 * secret, so the form posts here instead and this handler — which runs only on
 * the server — signs on its behalf and forwards to the real webhook. The
 * secret is read from process.env at request time and is never placed in
 * next.config's `env` block, which would inline it into the client bundle.
 *
 * This is the only unauthenticated write path in the application, so it is
 * also where the abuse controls live: a body cap, a per-IP rate limit, and
 * validation that mirrors the webhook's own schema rather than trusting it to
 * be the last line.
 */

export const runtime = "nodejs";
// Signing and rate limiting are per request; nothing here may be cached.
export const dynamic = "force-dynamic";

/** Far below the webhook's 512kb, and far above any honest report. */
const MAX_BODY_BYTES = 32_000;

/*
 * The budget is spent before the body is parsed, so a rejected submission
 * costs a slot too. Five leaves room for a fumbled report and a retry after a
 * failure on our side, while still being far below what flooding needs.
 */
const PER_IP_LIMIT = 5;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
/** A ceiling for everyone together, so one report per IP across many IPs still cannot flood the queue. */
const GLOBAL_LIMIT = 60;
const GLOBAL_WINDOW_MS = 10 * 60 * 1000;

/** Mirrors reportSchema in server/src/incidents/intake.ts. */
const LIMITS = {
  title: { min: 3, max: 200, label: "a short title" },
  service: { min: 1, max: 100, label: "the affected service" },
  description: { min: 10, max: 12_000, label: "a description" },
} as const;

type Field = keyof typeof LIMITS;

function validate(body: unknown): { values: Record<Field, string> } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Send a JSON object." };
  const values = {} as Record<Field, string>;

  for (const field of Object.keys(LIMITS) as Field[]) {
    const raw = (body as Record<string, unknown>)[field];
    if (typeof raw !== "string") return { error: `Provide ${LIMITS[field].label}.` };
    const value = raw.trim();
    const { min, max, label } = LIMITS[field];
    if (value.length < min) return { error: `Provide ${label} of at least ${min} characters.` };
    if (value.length > max) return { error: `Keep ${label} under ${max} characters.` };
    values[field] = value;
  }

  return { values };
}

/**
 * Behind a proxy the left-most entry is the client; with no proxy the header
 * is absent and every caller shares the "direct" bucket. The header is
 * spoofable by anyone talking to this server directly, which is the reason the
 * global limit exists alongside the per-IP one.
 */
function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "direct";
}

function tooMany(retryAfterSeconds: number) {
  // Someone who is blocked can act on a number; "try again later" leaves them
  // refreshing. Round up so the retry they are told about actually succeeds.
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return NextResponse.json(
    {
      error: `Too many reports from here. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

export async function POST(request: Request) {
  const secret = process.env.INCIDENT_WEBHOOK_SECRET;
  if (!secret) {
    // Say the same thing the webhook says, rather than inventing a success for
    // a report that was never stored.
    return NextResponse.json(
      { error: "Incident reporting is not configured on this deployment." },
      { status: 503 },
    );
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That report is too long." }, { status: 413 });
  }

  const perIp = take(clientKey(request), PER_IP_LIMIT, PER_IP_WINDOW_MS);
  if (!perIp.ok) return tooMany(perIp.retryAfterSeconds);
  const global = take("__global__", GLOBAL_LIMIT, GLOBAL_WINDOW_MS);
  if (!global.ok) return tooMany(global.retryAfterSeconds);

  const raw = await request.text();
  // content-length can lie or be absent; this is the check that actually holds.
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That report is too long." }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Send a JSON object." }, { status: 400 });
  }

  const checked = validate(parsed);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  /*
   * eventId is the webhook's idempotency key — incoming_incidents is unique on
   * (source, event_id). An anonymous submitter has no stable identity to
   * derive one from, and accepting one from the browser would let a caller
   * choose a key that collides with somebody else's report and silently
   * suppress it. So the proxy mints one per accepted submission: a resend is a
   * new incident, and the rate limit is what stops that being abused.
   *
   * severity is deliberately not accepted from the public either. The webhook
   * defaults it to medium; letting a stranger declare SEV-1 would put them in
   * charge of the queue order.
   */
  const payload = JSON.stringify({ eventId: randomUUID(), ...checked.values });

  let upstream: Response;
  try {
    upstream = await postSignedWebhook("incidents", payload, secret);
  } catch {
    return NextResponse.json(
      { error: "The incident service is unreachable. Please try again shortly." },
      { status: 503 },
    );
  }

  if (upstream.ok) return NextResponse.json({ received: true }, { status: 202 });

  // A 401 here means our own secret does not match the API server's, and a 400
  // means the two schemas have drifted. Both are operator errors the reporter
  // can do nothing about, so they get one honest failure rather than a detail
  // that only helps someone probing the endpoint.
  console.error(`Incident intake rejected a signed report with ${upstream.status}.`);
  return NextResponse.json(
    {
      error:
        upstream.status === 503
          ? "The incident service is not accepting reports right now. Please try again shortly."
          : "That report could not be filed. Please try again shortly.",
    },
    { status: 502 },
  );
}
