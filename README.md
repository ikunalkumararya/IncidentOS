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
| `/report` | Public incident report form. No sign-in. Posts through a server-side signing proxy. |
| `/shop` | Demo storefront. Its checkout fails on purpose so a customer can report a real incident. |

### The demo storefront

`/shop` is a prop with a purpose: ten products, a basket, and a checkout that
fails at the payment step every time. Nothing is charged and no payment provider
is contacted — the failure is simulated in the browser — but the report it
produces is real, and travels the same signed path as any other.

It exists because a report form on its own does not show the interesting part.
Here a customer hits a plausible failure, describes it in their own words, and
the technical context they could not be expected to supply — order reference,
timestamp, `ERR_CAPTURE_TIMEOUT`, basket contents — is attached automatically.
That context is what the investigation then has something to work with; the
resulting report cites the reference and the timestamp back at you.

The report is filed against `payments-api` rather than the page the customer was
on, because the failure is at capture.

### Both intake paths, from one page

The storefront header has a **Simulate a log spike** button, which is the other
way an incident starts: a collector noticing trouble with no customer involved.
It posts to `/api/logs`, a second signing proxy alongside the report one.

The browser supplies nothing but the click. The batch — thirteen lines of a
payments-api degradation, latency creeping, then memory, then the pod dying —
is written server-side in `apps/web/app/api/logs/route.ts`. That endpoint is
public and unauthenticated, and a batch reaching `/api/webhooks/logs` can raise
a critical incident on its own and have its lines fed to a model as evidence;
letting a caller dictate those lines would be letting them forge the evidence an
investigation reasons over.

Nor does the route decide the outcome. The batch goes to the real detector
(`detectAnomaly`), which applies its own thresholds and picks the title and
severity — the press above produced `payments-api: fatal log detected` at
critical, from the fatal line in the sample. The route reports what the detector
decided; it cannot fake a detection. Limited to three presses per IP per ten
minutes, tighter than reports, because one press raises a SEV-worthy incident by
itself.

### Seeding the dashboard

A fresh database shows an empty incident list. `pnpm seed:incidents` queues four
intakes across all three sources — a monitoring detection with log evidence, a
website report, another detection, and a manually raised one. `--reset` removes
them again, and re-running inserts nothing the second time.

What it seeds is the *intake* only: the report or the log batch, exactly as the
collector would have delivered it. The running worker then investigates each one
for real. Nothing writes phases, timings or reports directly — seeding those
would put fabricated numbers on screen beside measured ones with no way to tell
them apart. The API server has to be up for the queue to drain; with it down the
incidents sit queued until it returns. Expect about a minute and a half each,
run one at a time.

### Reporting an incident from the public site

`/report` lets someone with no account file an incident. It does not talk to the
API server directly: the intake webhook authenticates callers with a shared HMAC
secret, and a browser cannot hold that secret. The form posts to
`apps/web/app/api/report/route.ts`, a Next route handler that runs only on the
server, signs the exact bytes it forwards, and calls `POST /api/webhooks/incidents`.
From there the report is an ordinary queued incident — same table, same worker,
same review step as one raised by a teammate.

`INCIDENT_WEBHOOK_SECRET` reaches that handler through `process.env` at request
time. It is never listed in `next.config.mjs`'s `env` block, because every key in
that block is inlined into the client bundle at build time. With the secret unset
the form says intake is not configured rather than pretending to file anything.

This is the only unauthenticated write path in the app, so the proxy carries the
abuse controls: a 32 kB body cap, three reports per IP per ten minutes, and a
global ceiling of sixty in the same window. The limiter is in memory
(`apps/web/lib/rateLimit.ts`) — per process, forgiven on restart. That is
deliberately a speed bump for casual flooding rather than a real control; a
deployment that needs one wants a shared store.

Two fields are not accepted from the public. `eventId` is the webhook's
idempotency key, and letting a caller choose one would let them collide with
somebody else's report and silently suppress it, so the proxy mints one per
submission. `severity` is left to the webhook's `medium` default, because a
stranger who can declare SEV-1 controls the queue order.

Submitted text is untrusted and ends up in an LLM prompt. The worker's system
prompt already instructs treating report fields as data rather than instructions
([worker.ts](server/src/incidents/worker.ts)), and its output goes to a human for
review. That containment matters more if intake is ever wired to the tool-using
investigator, which can patch code.

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
  src/agent/         prompts + the streaming tool loop
  src/tools/         the 11 tools
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
DEMO_MODE=0
```

## Incident intake and investigation

The Incident analysis page lists real incidents, accepts team reports, and refreshes investigation
progress automatically. **View demo** opens the original fixture investigation separately.

- `POST /api/webhooks/incidents`: website-backend reports with `eventId`, `title`, `service`,
  `description`, and optional `severity` (`low`, `medium`, `high`, `critical`).
- `POST /api/webhooks/logs`: monitoring windows with `eventId`, `service`, and `entries` containing
  ISO `timestamp`, `level` (`debug`, `info`, `warn`, `error`, `fatal`), and `message`.
  Send at most 200 entries spanning at most five minutes. A fatal entry, OOM/crash signal, or at
  least five error entries comprising 20% of the batch creates an incident.
- Reuse the same `eventId` for delivery retries. Deduplication is by source and event ID;
  related alerts with different IDs are not grouped automatically.

Both webhook endpoints require `Content-Type: application/json`, `x-incident-timestamp` (Unix
seconds), and `x-incident-signature` (`sha256=` followed by the hex HMAC-SHA256 of
`<timestamp>.<exact request body>`). Use `INCIDENT_WEBHOOK_SECRET` on the sender backend and
IncidentOS server. Signatures expire after five minutes. Never put this secret in browser code.

For a local integration check, save a payload to a JSON file and run:

```bash
pnpm webhook:send incidents report.json
pnpm webhook:send logs logs.json
```

The sender defaults to localhost:4000; override `INCIDENT_API_URL` to target a hosted API.
For example, a report payload is:

```json
{"eventId":"website-ticket-123","title":"Checkout fails","service":"checkout","description":"Customers receive a 500 response when submitting payment.","severity":"high"}
```

Run `pnpm db:setup` after updating the schema, then restart the server. Incidents are persisted
before acknowledgment and processed by a database-backed queue with restart recovery. Analysis
uses the submitted report/logs, not the demo's telemetry. AI failures remain visible and can be
retried from the dashboard; completed findings require human review and do not apply fixes or
mark the underlying issue resolved. Configure a valid `CLAUDE_MODEL` and `ANTHROPIC_API_KEY`.
External log providers still need to forward their batches to the log endpoint.

## Auth routing

Signed-in users visiting `/`, `/signin`, or `/signup` are redirected to the dashboard after the
API validates their session. Invalid sessions and API outages leave sign-in accessible. For hosted
setups, `API_INTERNAL_URL` can specify the API address reachable by Next middleware; it otherwise
uses `NEXT_PUBLIC_API_BASE`, then localhost:4000.
