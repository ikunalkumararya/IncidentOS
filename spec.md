# IncidentOS

## 1. Product Overview

IncidentOS is an AI-powered SRE incident investigation and remediation platform.

It uses Claude as an autonomous incident investigator that can:

1. Understand an incoming production incident.
2. Investigate logs, metrics, Kubernetes events, deployments, and source code.
3. Generate multiple root-cause hypotheses.
4. Gather evidence for and against each hypothesis.
5. Determine the most likely root cause.
6. Propose and apply a code fix.
7. Run automated tests.
8. Verify whether the fix resolves the issue.
9. Generate a concise incident report.

The product is specifically designed as a hackathon demonstration of Claude's agentic reasoning, tool use, long-context understanding, coding ability, and verification loop.

---

# 2. Primary Demo Story

Use a single carefully designed production incident.

### Incident

A fictional payment service called:

`payments-api`

has started experiencing:

* increasing memory consumption
* Kubernetes pod restarts
* HTTP 500 errors
* increasing payment failures

The incident began shortly after deployment `v1.8.4`.

The actual root cause is a memory leak introduced by the latest deployment.

A transaction-processing function accidentally retains large request objects instead of storing only the required transaction fields.

---

# 3. The Demo Flow

The complete demo should be possible in approximately 2 minutes.

### Step 1 — Incident appears

Dashboard displays:

```text
INCIDENT #4821

Payment API Degradation

Status: INVESTIGATING

Error Rate: 18.7%
Memory Usage: 92%
Pods Restarting: 5
Started: 14:32
```

Button:

```text
INVESTIGATE INCIDENT
```

---

### Step 2 — Claude investigates

After clicking the button, show a live investigation timeline.

```text
INVESTIGATION

✓ Incident context loaded
✓ Application logs analyzed
✓ Metrics analyzed
✓ Kubernetes events analyzed
✓ Deployment history analyzed
✓ Relevant source code located

◉ Generating root-cause hypotheses...
```

---

### Step 3 — Hypotheses

Claude should generate multiple hypotheses.

Example:

```text
ROOT-CAUSE HYPOTHESES

1. Memory leak introduced in v1.8.4
   Confidence: 91%

2. Database connection exhaustion
   Confidence: 37%

3. Traffic spike
   Confidence: 22%
```

Do not immediately reveal the correct answer.

---

### Step 4 — Evidence gathering

Claude investigates each hypothesis.

Example UI:

```text
VERIFYING HYPOTHESES

Memory Leak
✓ Memory growth begins immediately after v1.8.4
✓ Pod restarts correlate with heap growth
✓ Relevant code changed in v1.8.4
✓ Same transaction objects retained in memory

Database Connections
✓ Connection count elevated
✗ No connection exhaustion
✗ No corresponding DB errors

Traffic Spike
✗ Traffic increased only 8%
✗ Does not explain memory growth
```

---

### Step 5 — Root cause

Display:

```text
ROOT CAUSE IDENTIFIED

Memory retention in transaction aggregation.

Confidence: 94%

Deployment v1.8.4 introduced a code path that
stores complete request objects in memory instead
of storing only the transaction fields required
for aggregation.

This causes heap growth under sustained traffic,
eventually triggering Kubernetes OOM kills.
```

---

# 4. Code Fix

Claude should locate the relevant code.

Example original code:

```typescript
const transactions: Request[] = [];

function processTransaction(req: Request) {
  transactions.push(req);

  return aggregateTransaction(req);
}
```

Claude should propose:

```typescript
const transactions: TransactionSummary[] = [];

function processTransaction(req: Request) {
  transactions.push({
    id: req.body.id,
    amount: req.body.amount,
    currency: req.body.currency
  });

  return aggregateTransaction(req);
}
```

The actual demo repository can contain a deliberately introduced bug.

---

# 5. Verification

After generating the patch:

```text
VERIFYING FIX

✓ TypeScript compilation
✓ Unit tests
✓ Regression test
✓ Memory simulation

47/47 tests passed

Memory simulation

Before fix: 1.82 GB
After fix: 0.91 GB

✓ Root cause reproduced
✓ Fix applied
✓ Fix verified
```

Then display:

```text
INCIDENT RESOLVED
```

---

# 6. Incident Report

Claude should automatically generate:

```text
INCIDENT REPORT

Incident: #4821
Service: payments-api
Severity: SEV-1

Root Cause:
Memory retention introduced in deployment v1.8.4.

Impact:
Payment requests experienced elevated 500 responses.

Resolution:
Replaced retained request objects with lightweight
transaction summaries.

Verification:
47/47 tests passed.
Memory simulation improved by 50%.

Recommended Follow-ups:
• Add memory regression testing.
• Add heap-growth alerting.
• Review request object lifecycle.
```

---

# 7. Product Architecture

Use a simple architecture.

```text
                 ┌─────────────────────┐
                 │      Next.js        │
                 │     Dashboard       │
                 └──────────┬──────────┘
                            │
                            ▼
                 ┌─────────────────────┐
                 │    Node.js API      │
                 │   Agent Controller  │
                 └──────────┬──────────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │      Claude      │
                  │    Investigator  │
                  └────────┬─────────┘
                           │
          ┌────────────────┼─────────────────┐
          │                │                 │
          ▼                ▼                 ▼
     Log Tools        Git Tools        Metrics Tools
          │                │                 │
          ▼                ▼                 ▼
       logs/             repo/            metrics/
          │
          ▼
     K8s Tools
          │
          ▼
       k8s-data/
```

Do NOT build a real Kubernetes cluster for the hackathon.

Use deterministic local incident data.

The illusion should feel like a real production investigation while keeping the system reliable for the demo.

---

# 8. Technology Stack

## Frontend

* Next.js
* TypeScript
* Tailwind CSS
* React
* shadcn/ui if convenient
* Recharts for charts if required

## Backend

* Node.js
* TypeScript
* Express

## AI

* Claude API
* Claude tool/function calling
* Streaming responses where useful

## Data

Use local files for the hackathon:

```text
demo-data/
```

No database is required unless it makes implementation easier.

---

# 9. Repository Structure

Create:

```text
incident-os/

├── apps/
│   └── web/
│       ├── app/
│       ├── components/
│       ├── lib/
│       └── package.json
│
├── server/
│   ├── src/
│   │   ├── agent/
│   │   │   ├── investigator.ts
│   │   │   ├── verifier.ts
│   │   │   ├── fixer.ts
│   │   │   └── prompts.ts
│   │   │
│   │   ├── tools/
│   │   │   ├── searchLogs.ts
│   │   │   ├── getMetrics.ts
│   │   │   ├── getKubernetesEvents.ts
│   │   │   ├── getDeploymentHistory.ts
│   │   │   ├── searchCode.ts
│   │   │   ├── readFile.ts
│   │   │   ├── applyPatch.ts
│   │   │   └── runTests.ts
│   │   │
│   │   ├── incidents/
│   │   └── index.ts
│   │
│   └── package.json
│
├── demo-data/
│   ├── logs/
│   │   ├── payments-api.log
│   │   └── payments-errors.log
│   │
│   ├── metrics/
│   │   ├── memory.json
│   │   ├── cpu.json
│   │   ├── requests.json
│   │   └── errors.json
│   │
│   ├── kubernetes/
│   │   ├── events.json
│   │   ├── pods.json
│   │   └── deployments.json
│   │
│   ├── deployments/
│   │   └── history.json
│   │
│   └── repository/
│       ├── payments-api/
│       │   ├── src/
│       │   ├── package.json
│       │   └── tests/
│       │
│       └── README.md
│
├── README.md
└── package.json
```

---

# 10. AI Agent Design

Do not implement a single giant prompt.

Create a tool-using investigator.

The agent should receive:

```text
Incident ID
Service
Severity
Symptoms
Start time
Known affected systems
```

Example:

```json
{
  "id": "INC-4821",
  "service": "payments-api",
  "severity": "SEV-1",
  "symptoms": [
    "HTTP 500 spike",
    "memory growth",
    "pod restarts"
  ],
  "startedAt": "14:32"
}
```

---

# 11. Available Claude Tools

Claude should have access to the following tools.

## search_logs

```typescript
search_logs({
  service?: string,
  query?: string,
  startTime?: string,
  endTime?: string
})
```

Returns matching logs.

---

## get_metrics

```typescript
get_metrics({
  service: string,
  metric: "memory" | "cpu" | "requests" | "errors"
})
```

Returns time-series data.

---

## get_kubernetes_events

```typescript
get_kubernetes_events({
  service?: string,
  pod?: string
})
```

---

## get_deployment_history

```typescript
get_deployment_history({
  service: string
})
```

---

## search_code

```typescript
search_code({
  query: string,
  path?: string
})
```

---

## read_file

```typescript
read_file({
  path: string
})
```

---

## apply_patch

```typescript
apply_patch({
  path: string,
  patch: string
})
```

For the hackathon, this may modify a temporary demo repository.

---

## run_tests

```typescript
run_tests({
  projectPath: string
})
```

Return:

```json
{
  "passed": 47,
  "failed": 0,
  "total": 47
}
```

---

# 12. Agent Investigation Strategy

Claude should follow this general process.

```text
1. Understand incident.

2. Establish timeline.

3. Inspect metrics.

4. Inspect logs.

5. Inspect Kubernetes events.

6. Inspect deployment history.

7. Generate at least 2 competing hypotheses.

8. Gather evidence for each.

9. Eliminate weak hypotheses.

10. Identify likely root cause.

11. Locate relevant source code.

12. Explain the root cause.

13. Generate a minimal patch.

14. Apply patch.

15. Run tests.

16. If tests fail:
       inspect failure
       modify patch
       rerun tests

17. Generate final incident report.
```

The agent must not claim a root cause without evidence.

---

# 13. Investigation State

The backend should emit events to the frontend.

Example:

```typescript
type InvestigationEvent =
  | {
      type: "started";
      message: string;
    }
  | {
      type: "tool_call";
      tool: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      tool: string;
      summary: string;
    }
  | {
      type: "hypothesis";
      hypothesis: string;
      confidence: number;
    }
  | {
      type: "evidence";
      hypothesis: string;
      evidence: string;
      supports: boolean;
    }
  | {
      type: "root_cause";
      explanation: string;
      confidence: number;
    }
  | {
      type: "patch";
      path: string;
      diff: string;
    }
  | {
      type: "test";
      passed: number;
      failed: number;
    }
  | {
      type: "resolved";
    };
```

Use Server-Sent Events or WebSockets.

For the hackathon, SSE is sufficient and simpler.

---

# 14. Frontend

The UI should look like a modern incident-management console.

Avoid generic chatbot UI.

The main page should contain:

```text
┌────────────────────────────────────────────────────┐
│ IncidentOS                              ● LIVE     │
├────────────────────────────────────────────────────┤
│                                                    │
│ INCIDENT #4821                                     │
│ Payment API Degradation                            │
│                                                    │
│ 🔴 SEV-1       18.7% errors       92% memory       │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ INVESTIGATION                                      │
│                                                    │
│ ✓ Logs analyzed                                    │
│ ✓ Metrics analyzed                                 │
│ ✓ Deployment history                               │
│ ✓ Kubernetes events                                │
│ ◉ Testing hypotheses...                            │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ ROOT CAUSE                                         │
│                                                    │
│ Memory retention introduced in v1.8.4              │
│                                                    │
│ Confidence: 94%                                    │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ CODE CHANGE                                        │
│                                                    │
│ - transactions.push(request)                       │
│ + transactions.push(transactionSummary)            │
│                                                    │
├────────────────────────────────────────────────────┤
│                                                    │
│ VERIFICATION                                       │
│                                                    │
│ ✓ 47 / 47 tests passed                             │
│ ✓ Memory regression verified                       │
│                                                    │
│              INCIDENT RESOLVED                     │
└────────────────────────────────────────────────────┘
```

---

# 15. Important UX Requirement

The user should be able to see Claude working.

Do NOT hide everything behind a loading spinner.

Show:

```text
Claude is investigating...

→ search_logs
→ get_metrics
→ get_deployment_history
→ search_code
→ read_file
→ hypothesis generated
→ hypothesis verified
→ patch generated
→ tests running
```

This is essential to the demo.

---

# 16. Demo Data

Create realistic data.

The timeline should look like:

```text
14:10
Deployment v1.8.3 healthy

14:21
Deployment v1.8.4 begins

14:24
Memory usage starts increasing

14:27
Memory reaches 70%

14:30
First pod restart

14:32
HTTP 500 errors spike

14:34
Memory reaches 90%

14:36
Multiple OOMKilled events

14:37
Incident declared
```

Traffic should NOT dramatically increase.

This allows Claude to eliminate the traffic-spike hypothesis.

---

# 17. Hidden Root Cause

The source code should contain a deliberate bug.

Example:

```typescript
const transactionCache: Request[] = [];

export function processPayment(req: Request) {
  transactionCache.push(req);

  return processTransaction(req.body);
}
```

The intended implementation should retain only necessary information.

```typescript
const transactionCache: TransactionSummary[] = [];

export function processPayment(req: Request) {
  transactionCache.push({
    id: req.body.id,
    amount: req.body.amount,
    currency: req.body.currency
  });

  return processTransaction(req.body);
}
```

Include a regression test that validates memory-safe behavior.

---

# 18. Reliability Requirement

The demo must be deterministic.

Do not rely on Claude to invent the entire incident.

The incident data, repository, expected root cause, and tests must already exist.

Claude's job is to discover the answer.

If Claude produces unexpected output, the application should still function.

Have a fallback demo mode.

```text
DEMO MODE
```

If the API fails, use a pre-recorded investigation event stream.

However, the primary demo should use the real Claude API.

---

# 19. Environment Variables

Create:

```text
ANTHROPIC_API_KEY=
CLAUDE_MODEL=
PORT=
```

Do not commit secrets.

---

# 20. Error Handling

If Claude API fails:

```text
Investigation paused.

Unable to reach AI investigation engine.

Retry
```

If a tool fails:

```text
Tool unavailable.

Claude will continue with available evidence.
```

The agent should not fabricate tool results.

---

# 21. Security

For the hackathon:

* Never execute arbitrary shell commands directly from Claude.
* Restrict file access to the demo repository.
* Restrict patch operations to the demo repository.
* Never expose API keys to frontend.
* Validate tool arguments.
* Run tests in a controlled temporary directory.

---

# 22. Stretch Features

Only implement these if the core demo is already working.

### A. Incident timeline visualization

Show:

```text
deployment
    ↓
memory growth
    ↓
pod restart
    ↓
500 errors
```

### B. Evidence graph

```text
             v1.8.4
                │
                ▼
        Transaction Handler
                │
                ▼
         Object Retention
                │
                ▼
          Memory Growth
                │
                ▼
            OOMKill
                │
                ▼
             500s
```

### C. Ask IncidentOS

Allow questions:

```text
Why did this happen?

What changed?

Could traffic have caused this?

What services were affected?

How do we prevent this?
```

### D. Git diff visualization

Show the exact code change.

### E. Incident export

Generate Markdown incident report.

---

# 23. Things NOT to Build

Do not build:

* authentication
* billing
* user management
* multi-tenancy
* real Kubernetes infrastructure
* real production deployment
* complex database architecture
* elaborate RBAC
* notification integrations
* Slack integration
* PagerDuty integration
* Grafana integration

These are distractions for the hackathon.

---

# 24. Definition of Done

The MVP is complete when this works:

```text
Open IncidentOS
        ↓
Click "Investigate"
        ↓
Claude calls tools
        ↓
Logs inspected
        ↓
Metrics inspected
        ↓
Deployment inspected
        ↓
Kubernetes events inspected
        ↓
Multiple hypotheses generated
        ↓
Evidence gathered
        ↓
Root cause identified
        ↓
Source code inspected
        ↓
Patch generated
        ↓
Patch applied
        ↓
Tests executed
        ↓
Tests pass
        ↓
Incident marked RESOLVED
        ↓
Incident report generated
```

---

# 25. Demo Script

Start with:

> "This is IncidentOS. Instead of asking an AI what might be wrong, we give it an actual production incident and let it investigate."

Then:

> "Our payment API is currently failing."

Click:

**INVESTIGATE**

Say:

> "Claude doesn't have the answer. It has tools."

Show:

```text
searching logs
checking metrics
checking deployments
checking Kubernetes events
```

Then:

> "It has generated three hypotheses."

Show them.

Then:

> "Now it's trying to disprove them."

Show evidence.

Then:

> "It found the deployment responsible."

Show:

```text
v1.8.4
↓
object retention
↓
memory growth
↓
OOM
```

Then:

> "Now the interesting part. It isn't stopping at the diagnosis."

Show code diff.

Then:

> "Claude generated a fix and is verifying it."

Show:

```text
47/47 tests passed
```

Finish with:

> **"IncidentOS doesn't just tell engineers what might be wrong. It investigates, proves the cause, fixes the problem, and verifies the fix."**

---

# 26. Product Tagline

Primary:

> **Investigate. Fix. Verify.**

Alternative:

> **Your AI SRE for production incidents.**

Alternative:

> **From alert to verified fix.**

---

# 27. Build Priority

Implement in exactly this order:

### P0 — MUST HAVE

1. Next.js dashboard
2. Incident data
3. Claude integration
4. Tool calling
5. Log tool
6. Metrics tool
7. Deployment tool
8. Kubernetes tool
9. Code search/read tool
10. Hypothesis generation
11. Root-cause analysis
12. Patch generation
13. Test execution
14. Investigation timeline

### P1

15. Beautiful UI
16. Code diff
17. Incident timeline
18. Final report

### P2

19. Evidence graph
20. Ask IncidentOS
21. Export report

Do not start P1/P2 until every P0 feature works.

---

# 28. Development Principle

The goal is NOT:

> Build a production-ready SRE platform.

The goal is:

> Build the most convincing 2-minute demonstration of autonomous AI incident investigation possible within the hackathon timeframe.

Optimize every engineering decision around that goal.

