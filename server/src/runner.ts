import { runAttackInvestigation } from "./agent/attackInvestigator.js";
import { runInvestigation } from "./agent/investigator.js";
import { API_KEY, ATTACK_TIMEOUT_MS, FORCE_DEMO_MODE, INVESTIGATION_TIMEOUT_MS } from "./config.js";
import { RunWriter } from "./db/store.js";
import type { RunKind } from "./events.js";
import { EventStream } from "./events.js";
import { loadFallback, replay, saveRecording } from "./recorder.js";
import { ACTIVE_INCIDENT_ID } from "./incidents/index.js";

export interface Run {
  id: string;
  kind: RunKind;
  stream: EventStream;
  mode: "live" | "demo";
  startedAt: number;
  finished: Promise<void>;
  abort(): void;
}

const current = new Map<RunKind, Run>();

export function getRun(id: string): Run | null {
  for (const run of current.values()) {
    if (run.id === id) return run;
  }
  return null;
}

export function getCurrentRun(kind: RunKind = "incident"): Run | null {
  return current.get(kind) ?? null;
}

/**
 * Starts a run of the given kind.
 *
 * Incident runs: the live agent is the primary path. If it fails — no API
 * key, an API error, or simply taking longer than the demo can afford — the
 * run does not die: it announces the switch and finishes from the recorded
 * stream. A `demo_mode` event tells the client to reset its timeline, because
 * the recording replays the investigation from the beginning rather than
 * resuming it.
 *
 * Attack runs: live agent only, per the HLD — there is no recorded fallback,
 * so an unavailable API or a timeout is reported as a fatal error instead of
 * silently switching to a recording of a different campaign. Attack runs are
 * also never saved with saveRecording: `pnpm demo:promote` picks the newest
 * run-*.json file, and promoting an attack run would silently replace the
 * incident demo's fallback with the wrong kind of run.
 */
export function startRun(kind: RunKind): Run {
  current.get(kind)?.abort();

  const stream = new EventStream();
  const controller = new AbortController();
  const id = `run_${Date.now().toString(36)}`;
  const useDemo = kind === "incident" && (FORCE_DEMO_MODE || !API_KEY);

  const run: Run = {
    id,
    kind,
    stream,
    mode: useDemo ? "demo" : "live",
    startedAt: Date.now(),
    finished: Promise.resolve(),
    abort: () => controller.abort(),
  };

  // Recording is a side effect of the stream, not a step in the run: it
  // subscribes like any other consumer, so nothing below has to know the
  // database exists and a run behaves identically when it is down.
  const writer = new RunWriter(id);
  writer.begin(run.mode, kind === "incident" ? ACTIVE_INCIDENT_ID : null, kind);
  stream.subscribe((event) => writer.record(event));

  run.finished = (async () => {
    let timer: NodeJS.Timeout | undefined;

    try {
      if (kind === "attack") {
        if (FORCE_DEMO_MODE || !API_KEY) {
          stream.emit({
            type: "error",
            fatal: true,
            message:
              "Attack analysis has no recorded fallback and requires a live ANTHROPIC_API_KEY. " +
              "Set it in .env and try again.",
          });
          return;
        }

        timer = setTimeout(() => controller.abort(), ATTACK_TIMEOUT_MS);
        try {
          await runAttackInvestigation(stream.emit, controller.signal);
        } catch (error) {
          const reason = controller.signal.aborted
            ? `The live investigation exceeded its ${Math.round(ATTACK_TIMEOUT_MS / 1000)}s budget.`
            : `The AI investigation engine is unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`;
          stream.emit({ type: "error", fatal: true, message: reason });
        }
        return;
      }

      if (useDemo) {
        await runFallback(
          stream,
          controller.signal,
          FORCE_DEMO_MODE ? "DEMO_MODE is enabled." : "No ANTHROPIC_API_KEY is configured.",
        );
        return;
      }

      timer = setTimeout(() => controller.abort(), INVESTIGATION_TIMEOUT_MS);

      try {
        await runInvestigation(stream.emit, controller.signal);
        stream.emit({ type: "resolved", durationMs: stream.elapsedMs });
        await saveRecording(stream.snapshot()).catch(() => undefined);
      } catch (error) {
        const reason = controller.signal.aborted
          ? `The live investigation exceeded its ${Math.round(INVESTIGATION_TIMEOUT_MS / 1000)}s budget.`
          : `The AI investigation engine is unavailable: ${
              error instanceof Error ? error.message : String(error)
            }`;

        run.mode = "demo";
        // The timeout controller already fired; the replay needs its own.
        const replayController = new AbortController();
        run.abort = () => replayController.abort();
        await runFallback(stream, replayController.signal, reason);
      }
    } finally {
      clearTimeout(timer);
      const elapsed = stream.elapsedMs;
      stream.close();

      // A run that was aborted or crashed emits no terminal event, so without
      // this it would stay 'running' in the database forever. Draining after
      // it keeps `finished` an honest signal that everything is on disk.
      writer.finalize(elapsed);
      await writer.flush();
    }
  })();

  current.set(kind, run);
  return run;
}

export const startInvestigation = () => startRun("incident");

async function runFallback(stream: EventStream, signal: AbortSignal, reason: string): Promise<void> {
  const recorded = loadFallback();

  if (!recorded) {
    stream.emit({
      type: "error",
      message:
        `${reason} No recorded investigation is available either — ` +
        `run one live with an API key, then promote it with \`pnpm demo:promote\`.`,
      fatal: true,
    });
    return;
  }

  stream.emit({ type: "demo_mode", reason });
  await replay(recorded, stream.emit, signal);
}
