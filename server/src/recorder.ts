import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FALLBACK_RECORDING, RECORDINGS_DIR } from "./config.js";
import type { Emit, TimedEvent } from "./events.js";

/**
 * Persists a completed run so it can be replayed later.
 *
 * The fallback stream in spec §18 is never hand-authored: it is a recording of
 * a real run, promoted once you get one you like. That keeps it consistent
 * with what the live agent actually does, and it costs nothing to maintain.
 */
export async function saveRecording(events: TimedEvent[]): Promise<string> {
  await mkdir(RECORDINGS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(RECORDINGS_DIR, `run-${stamp}.json`);
  await writeFile(path, JSON.stringify({ recordedAt: stamp, events }, null, 2) + "\n", "utf8");
  return path;
}

export function loadFallback(): TimedEvent[] | null {
  if (!existsSync(FALLBACK_RECORDING)) return null;
  try {
    const parsed = JSON.parse(readFileSync(FALLBACK_RECORDING, "utf8")) as { events: TimedEvent[] };
    return Array.isArray(parsed.events) && parsed.events.length ? parsed.events : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/**
 * Re-emits a recorded run with its original pacing.
 *
 * Gaps are clamped: a live run can stall for ten seconds waiting on the API,
 * and replaying that faithfully would just look broken. The point of the
 * recording is to look like the investigation, not to reproduce its latency.
 */
export async function replay(events: TimedEvent[], emit: Emit, signal: AbortSignal): Promise<void> {
  const MIN_GAP_MS = 60;
  const MAX_GAP_MS = 900;

  let previous = 0;
  for (const event of events) {
    if (signal.aborted) return;
    const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, event.at - previous));
    previous = event.at;
    await sleep(gap, signal);

    const { at: _at, seq: _seq, ...rest } = event;
    emit(rest);
  }
}
