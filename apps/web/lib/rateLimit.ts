/**
 * A sliding-window limiter for the public report endpoint, held in memory.
 *
 * In memory means per process: two Next instances behind a load balancer each
 * enforce their own budget, and a restart forgives everyone. That is the wrong
 * shape for a real abuse control and the right shape for this demo, which has
 * no Redis and one web process. It raises the cost of casual flooding, which
 * is what it is for. The public endpoint also has a body size cap and the
 * queue behind it is idempotent, so this is one layer of several rather than
 * the only thing standing between a stranger and the database.
 */

type Window = number[];

const hits = new Map<string, Window>();

/** Bound the map so a spray of distinct keys cannot grow it without limit. */
const MAX_KEYS = 5_000;

function prune(now: number, windowMs: number) {
  for (const [key, times] of hits) {
    const live = times.filter((t) => now - t < windowMs);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
}

/**
 * Records a hit against `key` and reports whether it is allowed. Callers get
 * back the seconds to wait so the response can say something useful rather
 * than just refusing.
 */
export function take(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { ok: boolean; retryAfterSeconds: number } {
  if (hits.size > MAX_KEYS) prune(now, windowMs);

  const times = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (times.length >= limit) {
    // The oldest hit in the window is the one that has to expire before there
    // is room for another.
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - times[0])) / 1000));
    hits.set(key, times);
    return { ok: false, retryAfterSeconds };
  }

  times.push(now);
  hits.set(key, times);
  return { ok: true, retryAfterSeconds: 0 };
}

/** Exposed for tests; there is no other reason to drop the window. */
export function resetRateLimits() {
  hits.clear();
}
