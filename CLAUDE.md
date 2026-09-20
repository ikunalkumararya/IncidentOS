# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Multi-stage development workflow

New feature work in this repo follows a three-stage, model-tiered pipeline. Do not skip stages or
write code before the earlier stages' docs exist and have been reviewed.

1. **HLD (Fable / creative planner tier)** — analyze requirements, produce a High-Level Design:
   architecture overview, data models, step-by-step implementation roadmap. Save to `docs/HLD.md`.
   No code in this stage.

When Claude Code is asked to run this pipeline, use the Agent tool with the `model` override
(`fable`, `opus`, `sonnet`) to execute each stage on its designated tier, and gate each handoff on
the prior stage's doc actually existing rather than firing all three stages blindly in sequence.

## What this is

IncidentOS is a demo of an AI SRE: Claude is handed a simulated production incident (a payments
service with a memory leak) with real telemetry and a real buggy repository, and investigates it
through tool use — forming hypotheses, gathering evidence, proving a root cause, patching the code,
and verifying the fix by actually running the test suite and a memory measurement. Nothing about the
outcome is scripted; the timeline, metrics, logs, and defect are generated once from a single
simulation so they cannot contradict each other, and the agent has to discover the answer itself.

`README.md` documents the design in depth (architecture rationale, reliability/fallback design,
security model, deliberate deviations from `spec.md`) — read it before making structural changes.
`spec.md` is the original hackathon spec; the two disagree in places (see README's "Deliberate
deviations from the spec" table), and the README + actual code reflect what was actually built.

## Commands

```bash
pnpm install
cp .env.example .env              # then set ANTHROPIC_API_KEY
pnpm generate:demo-data           # (re)generates demo-data/ from the incident simulation
pnpm dev                          # server on :4000 + dashboard on :3000, concurrently
pnpm dev:server                   # server only
pnpm dev:web                      # dashboard only
pnpm investigate                  # run one investigation in the terminal, no dashboard
pnpm typecheck                    # tsc --noEmit against server/tsconfig.json
pnpm demo:promote                 # promote the last live run to recordings/ (the demo-mode fallback)
pnpm verify                       # preflight: fixtures match timeline, defect present, toolchain intact, fallback exists
```

Run `pnpm verify` before presenting a demo — it's the single check that fixtures, the injected
defect, and the fallback recording are all still consistent.

There is no lint script and no test runner at the workspace root. Tests live inside the _generated_
demo repository (`demo-data/repository/payments-api`, vitest) and are executed by the agent itself
via the `run_tests` tool during an investigation, not by a developer command — the agent runs them
against `.sandbox/payments-api`, a throwaway copy created per run.

Per-package typecheck: `pnpm --filter @incident-os/server typecheck` / `pnpm --filter @incident-os/web typecheck`.

## Architecture

```
apps/web/            Next.js dashboard — SSE client + a pure reducer over the event stream
server/
  src/agent/         system prompts + the phased streaming tool loop (investigator.ts)
  src/tools/         the 11 tools Claude can call
  src/sandbox.ts     working copy management; fixed-argv test/typecheck/memory runners
  src/runner.ts      starts a run, enforces the wall-clock timeout, falls back to a recording
  src/recorder.ts    records live runs, replays recordings in demo mode
  src/events.ts      EventStream: pub/sub used to drive SSE
  src/timeline.ts    derives the incident-card chart/timeline from the generated fixtures
demo-data/
  logs/ metrics/ kubernetes/ deployments/ incidents/   generated fixtures (do not hand-edit)
  repository/payments-api/                              the buggy demo service + its own test suite
scripts/             generate-demo-data.ts, verify-setup.ts, promote-recording.ts
```

### One phased conversation, not separate agents

`server/src/agent/investigator.ts` runs a single Claude conversation through five phases —
investigate, hypothesize, prove, fix, report — rather than separate investigator/verifier/fixer
agents (as `spec.md` originally called for). Keeping it one conversation means the model keeps
context across the fix step, and the **tool list passed to the API must stay identical on every
turn of every phase** (`server/src/tools/index.ts`) — reordering, adding, or conditionally omitting
tools mid-run invalidates the cached prompt prefix. Phase ordering is instead enforced by guards
inside individual tools.

### Rigor is enforced by tools, not by prompting

Alongside 8 read-only investigation tools, three tools only report structured state and do no other
work: `report_hypothesis`, `report_evidence`, `report_root_cause`. They emit a typed event to the
SSE stream and return — this is what lets the UI render hypotheses/evidence live instead of parsing
prose. These tools (plus `apply_patch`) also enforce the investigation's ordering rules by rejecting
calls that violate them, returning a specific, actionable error the model can react to:

- `report_root_cause` rejects fewer than 2 competing hypotheses, fewer than 2 supporting evidence
  items for the winner, or any hypothesis that was never examined.
- `apply_patch` rejects being called before a root cause is proven.

When adding or changing a tool, put invariants like these inside the tool's `run()` (see
`server/src/tools/types.ts` for the `ToolDefinition`/`ToolError` shapes), not in the prompt.

### Sandbox and security model

The agent only ever touches `.sandbox/payments-api`, a fresh copy of
`demo-data/repository/payments-api` recreated at the start of every run (`prepareSandbox` in
`server/src/sandbox.ts`). Every model-supplied path goes through `resolveInSandbox`, which resolves
the path and then checks it lands inside the sandbox root — `..` and absolute paths are rejected
after resolution, not by string matching. `run_tests` and the memory simulation are fixed `execFile`
argument vectors defined in `sandbox.ts`; the model never supplies a command or argument, and there
is no shell to inject into. The Anthropic API key is stripped from the environment of every spawned
process. A failing tool returns a real error to the model — never a fabricated result.

### Reliability: live path + recording fallback

The primary path is the live Anthropic API. `server/src/runner.ts` wraps it with:

- a wall-clock cap (`INVESTIGATION_TIMEOUT_MS`, default 90s) — on timeout or API failure, the run
  emits `demo_mode` and finishes from the last promoted recording instead of failing outright;
- `DEMO_MODE=1` to always replay the recording and never call the API;
- every successful live run is auto-recorded (`recorder.ts`); `pnpm demo:promote` promotes one to
  become the fallback (it refuses to promote a run that never reached a verified fix).

The frontend reducer (`apps/web/lib/useInvestigation.ts`) is pure over the SSE event stream, so a
replayed recording produces a pixel-identical UI to the live run that produced it — the client
cannot tell live and replayed runs apart except via the `demo_mode` event.

### Demo data generation is self-checking

`scripts/generate-demo-data.ts` runs one incident simulation (per-pod heap growth, OOM kills, error
rates derived from pod availability) and writes every fixture — logs, metrics, k8s events, pod
status, deployment history — from that single source of truth, so they cannot contradict each other.
The expected timeline is encoded as assertions in the generator; if a tuning change breaks the
story, generation fails instead of silently shipping bad fixtures. Never hand-edit files under
`demo-data/` other than `demo-data/repository/payments-api` — regenerate via
`pnpm generate:demo-data` instead.

The injected defect lives in `demo-data/repository/payments-api/src/transactions.ts`: it retains
full inbound request objects in a queue meant to be safe when holding just their extracted summary
fields. Its own memory simulation script and vitest suite are what `measureMemory`/`run_tests` in
`server/src/sandbox.ts` actually execute — real measurements, not fixtures.
