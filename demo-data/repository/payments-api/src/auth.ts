/**
 * Handler for `/v1/auth/token`: verifies a service or user credential pair
 * and issues a short-lived session token.
 *
 * Brute-force protection: attempts are throttled per source address,
 * matching WAF rule auth-burst-v3 (see the edge config). Any single address
 * is capped at `PER_IP_LIMIT` attempts per `AUTH_WINDOW_MS`; once tripped,
 * further attempts from that address are rejected without touching the
 * credential store. Added in v1.8.2.
 */

export interface TokenRequest {
  account: string;
  password: string;
  remoteAddress: string;
  receivedAt: number;
}

export type TokenResult =
  | { ok: true; token: string; account: string }
  | { ok: false; reason: "invalid_credentials" | "rate_limited" | "mfa_required" };

/** Northwind service and staff accounts known to this environment. */
const CREDENTIALS: Map<string, string> = new Map([
  ["billing-svc@northwind.example", "Qu1llFerry-Batch9"],
  ["ops-runner@northwind.example", "Trellis-Cobalt-42"],
  ["a.okafor@northwind.example", "HarborKite!7v"],
  ["d.nkemdirim@northwind.example", "Marl-Ostrich-19"],
  ["s.varga@northwind.example", "PineDrift#204"],
  ["m.oyelaran@northwind.example", "Cinder-Vellum-8"],
  ["finance-bot@northwind.example", "Ledger-Thistle-3"],
  ["k.dlamini@northwind.example", "Amber-Trowel-56"],
]);

/**
 * Accounts enrolled in multi-factor auth. A correct password alone is not
 * enough for these; the caller must complete a separate MFA challenge before
 * a session is issued. `billing-svc` is a legacy service account that
 * predates the MFA rollout and was never migrated.
 */
const MFA_ENROLLED: Set<string> = new Set([
  "ops-runner@northwind.example",
  "a.okafor@northwind.example",
  "d.nkemdirim@northwind.example",
  "s.varga@northwind.example",
  "m.oyelaran@northwind.example",
  "finance-bot@northwind.example",
  "k.dlamini@northwind.example",
]);

/** Maximum attempts a single source address may make within the window. */
export const PER_IP_LIMIT = 30;

/** Sliding window over which per-address attempts are counted. */
export const AUTH_WINDOW_MS = 60_000;

/** Attempt timestamps per source address, most recent last. */
const ipAttempts = new Map<string, number[]>();

/** Active sessions issued since the last reset. */
const sessions: string[] = [];

function pruneAndRecord(remoteAddress: string, receivedAt: number): number {
  const cutoff = receivedAt - AUTH_WINDOW_MS;
  const existing = ipAttempts.get(remoteAddress) ?? [];
  const recent = existing.filter((t) => t > cutoff);
  recent.push(receivedAt);
  ipAttempts.set(remoteAddress, recent);
  return recent.length;
}

/**
 * Verifies a token request and issues a session, subject to the per-address
 * throttle above.
 */
export function issueToken(req: TokenRequest): TokenResult {
  const { account, password, remoteAddress, receivedAt } = req;

  const attemptsInWindow = pruneAndRecord(remoteAddress, receivedAt);
  if (attemptsInWindow > PER_IP_LIMIT) {
    return { ok: false, reason: "rate_limited" };
  }

  if (CREDENTIALS.get(account) !== password) {
    return { ok: false, reason: "invalid_credentials" };
  }

  if (MFA_ENROLLED.has(account)) {
    return { ok: false, reason: "mfa_required" };
  }

  const token = `tok_${account}_${receivedAt}`;
  sessions.push(token);
  return { ok: true, token, account };
}

/** Test/bootstrap helper. */
export function resetAuthState(): void {
  ipAttempts.clear();
  sessions.length = 0;
}

/** Number of sessions issued since the last reset. */
export function getActiveSessionCount(): number {
  return sessions.length;
}

/** All known account identifiers. Used by diagnostics and tests. */
export function listAccounts(): string[] {
  return [...CREDENTIALS.keys()];
}
