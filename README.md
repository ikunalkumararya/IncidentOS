# IncidentOS

**Investigate. Fix. Verify.**

An AI SRE that is handed a real production incident — real telemetry, a real repository with a real
defect in it — and has to work out what happened. It is not told the answer. It has tools.

It investigates, forms competing hypotheses, gathers evidence for and against each one, eliminates
the ones that do not survive, proves a root cause, patches the code, and verifies the fix against the
test suite and a real memory measurement.

---

## Quick start

```bash
pnpm install
cp .env.example .env          # then add your ANTHROPIC_API_KEY
pnpm db:up                    # local Postgres; skip when using Neon
pnpm generate:demo-data       # writes demo-data/ from the incident simulation
pnpm dev                      # server on :4000, dashboard on :3000
```

Open <http://localhost:3000> for the landing page, or go straight to
<http://localhost:3000/dashboard> and press **Investigate incident**.

| Route | What it is |
|---|---|
| `/` | Landing page. Fully static — no server, no API key, no network. The investigation replay on it is scripted from a real run. |
| `/signin`, `/signup` | Database-backed registration and sign-in. |
| `/dashboard` | Incident and attack analysis. Requires sign-in and the API server. |

### Shared database with Neon

The existing `pg` driver supports Neon PostgreSQL; no extra SDK is needed.

1. Create a Neon project and copy the **pooled connection string** from its Connect dialog.
2. In the root `.env`, set `DATABASE_URL` to that string, preserving its SSL parameters.
   Keep `PERSIST=1` and `DATABASE_CONNECT_TIMEOUT_MS=15000`.
3. Set `SEED_DEMO_USER=0` before the first boot of a shared database. Set `JWT_SECRET` to a
   random secret (generate one with `openssl rand -hex 32`). Never use a `NEXT_PUBLIC_` variable
   for database credentials or the JWT secret.
4. Run `pnpm db:check` to check connectivity and TLS without changing the database.
5. Run `pnpm dev`. The server automatically creates the tables in `server/src/db/schema.sql`.
   Each teammate can register at `/signup`.

Docker is optional when using Neon. The `db:up`, `db:down`, `db:reset`, and `db:psql` commands
only manage the local Docker database; they do not manage Neon. Existing local data is not
copied automatically. Disabling demo seeding does not remove an already-created demo account.

Accounts and saved investigation runs are shared by every app server using the same database.
This is one shared workspace: all registered users can access run history through the API;
there are no team roles, invitations, comments, or workspace isolation yet. Incident and attack
telemetry still comes from `demo-data/`. The dashboard does not yet provide a saved-run browser.
Live streams and active runs remain in server memory, so use one shared API server for the team.

For a hosted team app, serve the web app and API under the same HTTPS origin (proxy `/api` to
Express), set `WEB_ORIGIN` to that origin, and build the web app with `NEXT_PUBLIC_API_BASE`
set to that origin. Set `NODE_ENV=production` on the server for secure session cookies.
Hosting the app is a separate step from connecting the database.

See [Neon's connection pooling documentation](https://neon.com/docs/connect/connection-pooling).

To watch it in the terminal instead, without the dashboard:

```bash
pnpm investigate
```

### Before you demo

```bash
pnpm verify
```

Checks the fixtures still match the incident timeline, the defect is still present in the demo
repository, the toolchain is intact, and a fallback recording exists. Run it five minutes before you
present.

---

## What actually happens when you press the button

```
prepareSandbox()            fresh copy of demo-data/repository/payments-api → .sandbox/
measureMemory()             baseline, on the unpatched code

  phase 1  investigate      metrics, logs, k8s events, deployment history
  phase 2  hypothesize      ≥3 competing hypotheses, with priors
  phase 3  prove            evidence for and against each; eliminate; declare a cause
  phase 4  fix              locate the defect, patch it, run the suite, iterate on failure

measureMemory()             again, on the patched code
  phase 5  report           the incident report
```

Phases 1–4 are Claude driving tools. The measurements either side are taken by the server, not by
the model — the credibility of the numbers rests on them being taken by something with no stake in
the answer.

### The findings are tool calls, not parsed prose

The hard part of this UI is showing *structured* investigation state — hypotheses with confidences,
evidence for and against, a root cause — while the model is still working. Recovering that from prose
is fragile.

So alongside the eight tools that read data, the agent has three that only report:

```ts
report_hypothesis({ id, hypothesis, confidence, rationale })
report_evidence({ hypothesisId, evidence, supports, source })
report_root_cause({ hypothesisId, explanation, confidence })
```

They do no work. They emit a typed event and return. The timeline is therefore structured by
construction, and it arrives live.

They are also where the investigation's ordering rules are enforced, which is the difference between
asking a model to be rigorous and requiring it:

| Rule | Enforced by |
|---|---|
| At least 2 competing hypotheses before any conclusion | `report_root_cause` rejects fewer |
| ≥2 pieces of supporting evidence for the winner | `report_root_cause` rejects fewer |
| **Every** hypothesis examined, including the losers | `report_root_cause` rejects unexamined ones |
| No patch without a proven cause | `apply_patch` rejects it |

A rejection comes back to the model as a specific, actionable error, so it corrects itself rather
than producing a timeline with holes in it.

---

## The demo data is generated, and it self-checks

`scripts/generate-demo-data.ts` simulates the incident — five pods, per-pod heap growth, OOM kills,
error rates derived from pod availability — and writes every fixture from that one simulation. Logs,
metrics, Kubernetes events and pod status therefore cannot contradict each other.

The timeline from the spec is encoded as **assertions**, so a tuning change that breaks the story
fails generation instead of silently shipping:

```
✓ 14:10 v1.8.3 healthy          ✓ 14:30 first pod restart
✓ 14:24 memory climbing         ✓ 14:32 HTTP 500s spike
✓ 14:27 memory reaches ~70%     ✓ 14:34 memory reaches ~90%
✓ traffic does not spike        ✓ db pool never exhausted
✓ no two pods OOM-killed in the same minute
```

The last three matter most. Two of the three hypotheses have to be *falsifiable* — traffic rises only
8%, and the connection pool is genuinely elevated but never exhausted — or the agent has nothing to
rule out.

---

## The defect

`demo-data/repository/payments-api/src/transactions.ts`:

```ts
const transactionCache: PaymentRequest[] = [];

export function processPayment(req: PaymentRequest): AggregationResult {
  validatePaymentBody(req.body);
  transactionCache.push(req);            // ← retains the whole request
  return aggregateTransaction(req.body);
}
```

The settlement queue is *meant* to grow within a settlement period — it is drained by a worker on its
own schedule. That is safe while each entry is ~80 bytes. Retaining the inbound request instead keeps
the 4 KiB raw payload and the header map alive per transaction, which is a ~32× increase in retained
bytes and walks the container into its 2Gi limit under sustained traffic.

The fix is to queue a `TransactionSummary`. The design was fine; the implementation retained too much.

### It is verified for real

| | Before | After |
|---|---|---|
| Tests | **46 / 47** | **47 / 47** |
| Retained over 25,000 captures | **112.46 MB** | **3.55 MB** |
| Retained per transaction | 4,717 B | 149 B |

Both numbers come from actually running the code. `scripts/memory-sim.ts` captures 25,000 payments
and measures `heapUsed + external` — `external`, because the raw payloads are `Uint8Array` backing
stores that live *outside* the V8 heap. Measuring `heapUsed` alone reports a comfortable number for a
process that is about to be OOM-killed, which is the same trap the incident itself is about.

---

## Reliability

The primary path is the live API. Everything else exists so a bad network never becomes a failed
demo.

- **Every run is recorded** to `recordings/`. Promote one you like with `pnpm demo:promote`; it
  becomes the fallback. The fallback is never hand-authored, so it always matches what the agent
  really does. `demo:promote` refuses to promote a run that never reached a verified fix.
- **A 90s wall-clock cap** (`INVESTIGATION_TIMEOUT_MS`). If the live run exceeds it, the server aborts
  it, emits `demo_mode` with the reason, and finishes from the recording.
- **`DEMO_MODE=1`** forces the recording and never calls the API.
- The client reducer is pure, so a replay produces a pixel-identical UI to the live run that recorded
  it.

---

## Security

- Claude never supplies a command or an argument. `run_tests` and the memory simulation are fixed
  `execFile` argument vectors — no shell, so there is nothing to inject into. `run_tests` accepts a
  `projectPath` for interface compatibility and ignores it.
- Every model-supplied path is resolved and then checked to be inside `.sandbox/payments-api`;
  `..` and absolute paths are rejected after resolution, not by string inspection.
- The agent works on a throwaway copy, recreated per run. It cannot touch `demo-data/`.
- The API key stays server-side and is stripped from the environment of every spawned process.
- A tool that fails returns an error the model can read. It is never handed a fabricated result.

---

## Layout

```
apps/web/
  app/page.tsx       landing page
  app/signin|signup/ presentational auth pages
  app/console/       the live dashboard (SSE client, pure reducer)
  components/landing/ scripted investigation replay, scroll reveals
  components/auth/   auth shell, validated field
  lib/useValidatedForm.ts  when a field is allowed to show an error
server/
  src/agent/         prompts + the streaming tool loop, per run kind
  src/tools/         incident (11) and attack (16) tool registries
  src/sandbox.ts     working copy, fixed-argv test/typecheck/memory runners
  src/runner.ts      live run, timeout, fallback to the recording
demo-data/
  logs/ metrics/ kubernetes/ deployments/ incidents/   generated fixtures
  repository/payments-api/                             the buggy service
scripts/             fixture generator, preflight, recording promotion
```

---

## Deliberate deviations from the spec

| Spec | Built | Why |
|---|---|---|
| `apply_patch({ path, patch })` unified diff | `apply_patch({ path, find, replace, rationale })` | Models generate exact-string edits far more reliably than valid diffs, and a failed patch kills the demo. The UI still renders a proper unified diff — computed from the edit, so it cannot disagree with what was written. |
| 47/47 tests pass | 46/47 → 47/47 | A regression test that passes before the fix is not a regression test. Showing it go red → green proves the fix instead of asserting it. |
| Before 1.82 GB / after 0.91 GB (50%) | 112.46 MB → 3.55 MB (96.8%) | Real measured numbers rather than fixtures. A 2 GB simulation would also risk OOM-ing the demo laptop. |
| `Pods Restarting: 5` | 3 of 5 at declaration | Read from the simulation. Only 3 pods had restarted by 14:37; the other two follow at 14:39 and 14:40. |
| Error rate 18.7% | 17.7% | Also read from the simulation rather than hardcoded, so the card always agrees with the metrics the agent fetches. |
| Separate `verifier.ts` / `fixer.ts` | One phased loop in `investigator.ts` | Same phases, one conversation — the model keeps its context across the fix, and the stable tool list keeps the prompt cache valid. |

---

## Environment

```
ANTHROPIC_API_KEY=          # required for the live demo
CLAUDE_MODEL=claude-opus-5
PORT=4000
INVESTIGATION_TIMEOUT_MS=90000
ATTACK_TIMEOUT_MS=180000
DEMO_MODE=0
```
