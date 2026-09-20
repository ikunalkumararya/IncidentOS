import { createHmac } from "node:crypto";

/**
 * Server-side signing for the intake webhooks.
 *
 * Both public entry points — a customer's report and a generated log batch —
 * have to reach an endpoint that authenticates callers with a shared HMAC
 * secret (server/src/incidents/intake.ts). A browser cannot hold that secret,
 * so each posts to a route handler that signs on its behalf. This is the part
 * they share; keeping it in one place means the wire format cannot drift
 * between them.
 *
 * Never import this from a client component. It reads the secret from
 * process.env at call time, and it is only ever valid on the server.
 */

export const API_URL = process.env.INCIDENT_API_URL ?? "http://localhost:4000";

/** Signs exactly the bytes it sends: HMAC-SHA256 over `<unix seconds>.<body>`. */
export async function postSignedWebhook(
  kind: "incidents" | "logs",
  payload: string,
  secret: string,
): Promise<Response> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(payload).digest("hex");

  return fetch(`${API_URL}/api/webhooks/${kind}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-incident-timestamp": timestamp,
      "x-incident-signature": `sha256=${signature}`,
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });
}
