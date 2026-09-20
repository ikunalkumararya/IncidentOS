import { runInvestigation } from "./agent/investigator.js";
import { API_KEY, FORCE_DEMO_MODE, INVESTIGATION_TIMEOUT_MS } from "./config.js";
import { EventStream } from "./events.js";
import { loadFallback, replay, saveRecording } from "./recorder.js";

export interface Run {
  id: string;
  stream: EventStream;
  mode: "live" | "demo";
  startedAt: number;
  finished: Promise<void>;
  abort(): void;
}

let current: Run | null = null;

export function getRun(id: string): Run | null {
  return current && current.id === id ? current : null;
}

export function getCurrentRun(): Run | null {
  return current;
}

/**
 * Starts an investigation.
 *
 * The live agent is the primary path. If it fails — no API key, an API error,
 * or simply taking longer than the demo can afford — the run does not die: it
 * announces the switch and finishes from the recorded stream. A `demo_mode`
 * event tells the client to reset its timeline, because the recording replays
 * the investigation from the beginning rather than resuming it.
 */
export function startInvestigation(): Run {
  current?.abort();

  const stream = new EventStream();
  const controller = new AbortController();
  const id = `run_${Date.now().toString(36)}`;
  const useDemo = FORCE_DEMO_MODE || !API_KEY;

  const run: Run = {
    id,
    stream,
    mode: useDemo ? "demo" : "live",
    startedAt: Date.now(),
    finished: Promise.resolve(),
    abort: () => controller.abort(),
  };

  run.finished = (async () => {
    let timer: NodeJS.Timeout | undefined;

    try {
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
      stream.close();
    }
  })();

  current = run;
  return run;
}

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
