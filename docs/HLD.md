# HLD — Attack Analysis as a live agent investigation

Stage 1 design document. Read alongside `README.md` (architecture rationale) and `CLAUDE.md`.

## 1. Problem

The Attack Analysis dashboard tab is a static report: one fetch of `GET /api/attack-analysis`, which
serves memoised JSON from `demo-data/security/*.json`. There is no agent, no event stream, no tools,
and the fixtures contain no source-code location or patchable defect. The tab must become a live
Claude-agent investigation of the credential-stuffing campaign SEC-2291 with the same rigour as the
incident flow: investigate → hypothesize → prove → locate code → patch → test → verify → report.

## 2. Product decisions

| Topic | Decision |
|---|---|
| Engine | Live Claude agent only. No recorded fallback for attack runs; if the API is unavailable the run emits a fatal error. |
| Priority + confidence | Decided by the agent through `report_attack_assessment { priority: Minor\|Major\|Urgent, confidence, rationale }`. Shown as tags top-right. Latest call wins. |
| Scope | Full loop: diagnose, locate the weakness in code, patch it in the sandbox, run tests, verify. |
| Injected defect | `src/auth.ts` token endpoint throttles **per source IP** only; there is **no per-account lockout**. A distributed attack that stays under the per-IP limit gets unlimited guesses per account and a matched credential on a non-MFA account yields a session. Fix = per-account failure window + lockout. |
| Verification | Red→green regression test (`tests/auth-lockout.test.ts`) plus `scripts/attack-sim.ts` (mirror of `memory-sim.ts`) run by the server before and after the patch. |
| Root cause section | Card with the confirmed cause and evidence for/against every hypothesis. |
| Live health metrics | Fixture series revealed progressively as the run advances; fully shown once resolved. |

## 3. Page layout

```
┌──────────────────────────────────────────────────────────┬────────────────────┐
│ ATTACK ANALYSIS                       [Urgent] [92% conf] │  ATTACK TIMELINE   │
├──────────────────────────────────────────────────────────┤  14:05 probing     │
│ ATTACK REPORT  SEC-2291 · Credential stuffing…           │  14:18 rate limit… │
│ service payments-api · db postgres/accounts              │  INVESTIGATION     │
│ start 14:05 · duration 33m · technique T1110.004         │  ✓ get_auth_attempts│
│ target /v1/auth/token · 6 sources/6 countries · 1 session│  ✓ report_hypothesis│
│ code: src/auth.ts:71 · issueToken()   [Investigate] ▶    │  ◉ read_file (now) │
│ phase stepper ○──●──○──○──○──○                            │  (sticky)          │
├──────────────────────────────────────────────────────────┤                    │
│ LIVE HEALTH METRICS (playback: auth series + cpu/mem/err)│                    │
├──────────────────────────────────────────────────────────┤                    │
│ ROOT CAUSE card + hypotheses w/ evidence for/against     │                    │
├──────────────────────────────────────────────────────────┤                    │
│ VERIFICATION (tests · attack replay before/after) · DIFF │                    │
├────────────────────────────┬─────────────────────────────┤                    │
│ LOGS (payments-api errors) │ KUBERNETES EVENTS           │                    │
└────────────────────────────┴─────────────────────────────┴────────────────────┘
```

## 4. Architecture

### 4.1 Per-kind sandboxes (prerequisite)
`.sandbox/<kind>/payments-api`, one per run kind (`incident` | `attack`), so concurrent runs never
clobber each other. All sandbox helpers take the root as a parameter; `ToolContext` carries
`sandboxRoot`.

**Regression-test scoping.** Both red regression tests live in the demo repository. A run's sandbox
must carry only its own subject's test or the other subject's failure blocks the green gate.
`prepareSandbox(kind)` removes `{ incident: [tests/auth-lockout.test.ts], attack: [tests/memory-regression.test.ts] }`.

### 4.2 Agent
- `agent/loop.ts` — `createConversation({ client, systemPrompt, registry, ctx, emit, signal, labels })`
  holds the message thread and the phase runner (moved verbatim from `investigator.ts`). Tool specs
  are computed once per registry so the tools block is byte-identical every turn (prompt cache).
- `agent/investigator.ts` — incident driver, unchanged behaviour, built on the loop.
- `agent/attackInvestigator.ts` + `agent/attackPrompts.ts` — attack driver: briefing from
  `buildAttackAnalysis().campaign`; phases investigate → hypothesize → prove → fix; server-side verify
  (`attack_sim` before/after, `verification "Attack replay"`); forced assessment turn if none was
  reported; green-tests gate; report.
- `Findings` extended additively: `kind`, `assessment`, `codeLocation`, `attackBefore/After`.

### 4.3 Tools
Two fixed-order registries in `tools/index.ts`: `INCIDENT_TOOLS` (existing 11) and `ATTACK_TOOLS` (16):
`get_auth_attempts, get_attack_sources, get_security_events, get_metrics, search_logs,
get_kubernetes_events, get_deployment_history, search_code, read_file, report_hypothesis,
report_evidence, report_root_cause, report_attack_assessment, report_code_location, apply_patch, run_tests`.

New tools read `demo-data/security/*.json`. `report_code_location { path, line, symbol, explanation }`
requires a root cause and validates the path/line inside the sandbox; for attack runs `apply_patch`
requires a code location first. Ordering rules stay inside tools, not prompts.

### 4.4 Events (additive)
```ts
| { type:"started"; incidentId; message; kind?: "incident"|"attack" }
| { type:"attack_assessment"; priority; confidence; rationale }
| { type:"code_location"; path; line; symbol; explanation }
| { type:"attack_sim"; before: AttackSimResult; after: AttackSimResult }
```

### 4.5 Runner, API, persistence
- `runner.ts`: runs keyed by kind (`Map<RunKind, Run>`); `startRun(kind)`; attack runs have their own
  `ATTACK_TIMEOUT_MS` (default 180 s), no fallback, and are **never recorded** (recording promotion
  picks the newest file and would contaminate the incident fallback).
- Routes: `POST /api/attack-investigations`; SSE reuses `GET /api/investigations/:id/events`;
  read-only `GET /api/logs`, `GET /api/kubernetes-events`; `buildAttackAnalysis()` gains a `health`
  series (cpu, memoryPeak, errorRate) + OOM markers.
- DB: `runs.kind` column (idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- CLI: `pnpm investigate:attack`.

### 4.6 Demo repository
- `src/auth.ts` — `issueToken(TokenRequest): TokenResult`, per-IP throttle (`PER_IP_LIMIT = 30`,
  `AUTH_WINDOW_MS = 60_000`), in-memory credential store with the fixture's compromised accounts,
  `MFA_ENROLLED` excluding `billing-svc`, time injected via `receivedAt`.
- `tests/auth.test.ts` (green), `tests/auth-lockout.test.ts` (red: 25 wrong guesses from 25 IPs then
  the right password from a 26th must be rejected).
- `scripts/attack-sim.ts` — replays the fixture's six-source distribution (≤ 28/min per source) and
  prints one JSON line: `{ attempts, sources, rateLimited, attemptsReachingVerifier, credentialsMatched,
  sessionsCreated, lockedAccounts }`. Expected before `{ matched 3, sessions 1, locked 0 }`, after
  `{ matched 0, sessions 0, locked 3 }`.
- `scripts/verify-setup.ts` asserts both defects are present and the security fixtures exist.

### 4.7 Frontend
- `useInvestigation(kind)` — one pure reducer, new state `kind, assessment, codeLocation, attackSim,
  phaseToolCount`.
- Extracted components: `Tag`, `Stat`, `PhaseStepper`, `RootCauseCard`; kind-agnostic `Verification`;
  `SmallMultiples` chart with `visibleCount` for playback; `LiveHealthChart`.
- `lib/playback.ts` — visible window derived from phase + tool count (pure; replays identical).
- Rebuilt `attack-analysis/page.tsx` per §3; `LogsPanel`, `KubernetesPanel`.

## 5. Data models

```ts
type RunKind = "incident" | "attack";
interface AttackAssessment { priority: "Minor"|"Major"|"Urgent"; confidence: number; rationale: string }
interface CodeLocation { path: string; line: number; symbol: string; explanation: string }
interface AttackSimResult {
  attempts: number; sources: number; rateLimited: number; attemptsReachingVerifier: number;
  credentialsMatched: number; sessionsCreated: number; lockedAccounts: number;
}
```

## 6. Roadmap

1. Per-kind sandbox refactor → typecheck.
2. Demo repo: `auth.ts`, tests, `attack-sim.ts` → 53/54 red; hand-fix → 54/54 + after numbers; revert.
3. Events / Findings / registries / loop extraction → incident `pnpm investigate` unchanged.
4. Attack driver + prompts + runner + routes + CLI → iterate headlessly.
5. DB `kind` column.
6. Frontend.
7. `verify-setup`, README, CLAUDE.md.

## 7. Risks
- Time budget (tsc + vitest + two sims + 16 tools × 5 phases) → 180 s default, explicit fix-phase sequence.
- Findability → briefing and `auth.ts` header both name `/v1/auth/token`.
- Fallback contamination → attack runs are never recorded.
