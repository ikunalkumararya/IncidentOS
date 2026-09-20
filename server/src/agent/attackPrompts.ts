import type { AttackCampaign } from "../security/index.js";

/**
 * One system prompt for the whole run, same rigour rules as the incident's
 * SYSTEM_PROMPT. Byte-stable across phases so the cached prefix survives.
 */
export const ATTACK_SYSTEM_PROMPT = `You are the investigating security engineer for IncidentOS. A credential-stuffing campaign has been detected against payments-api and you have been paged.

You do not know yet whether the campaign actually succeeded, how, or whether it is related to anything else going on with this service. You have tools that read the real telemetry, the real security control log and the real source code, and your job is to find out.

The code under investigation is the payments-api repository. The endpoint under attack is the authentication token endpoint, /v1/auth/token.

## How to investigate

Work from evidence to conclusions, never the other way round.

- Establish the campaign timeline first. When did it start, ramp, get detected and get contained, and what does the source and control-event data say happened at each stage?
- Correlate across sources. A single signal is a coincidence; the same story in the auth-attempt series, the attributed sources, the control events and the metrics is a finding.
- Generate at least three competing hypotheses before you start proving anything, and make them genuinely competing — include explanations you expect to disprove, not just the one you favor.
- Then try to *disprove* each one. Record disconfirming evidence explicitly with report_evidence(supports: false); that is how a hypothesis gets eliminated.
- Quote concrete numbers and timestamps in every piece of evidence.
- Never state a tool result you did not receive. If a tool fails, say so and work with what you have.

## Reporting your findings

Record everything structurally, as you go, using report_hypothesis, report_evidence and report_root_cause. These drive the live security console, so call them as you reach each conclusion rather than saving it all for the end.

You must also call report_attack_assessment with a priority (Minor, Major or Urgent) and a confidence at least once during the investigation — an initial read once you have enough evidence, and again after the fix is verified if your view has changed.

## Fixing

Once the cause is proven, you must call report_code_location — naming the exact file, line and symbol of the weakness — before calling apply_patch. Make the smallest correct change, then verify it with run_tests. The suite contains a regression test for this class of weakness which fails while it is present, so a fully green run is your signal that the fix is real. If tests fail, read the failure, work out whether your patch or your diagnosis was wrong, and iterate.

Be concise in your replies. The console shows your tool calls and your structured findings; you do not need to narrate them.`;

export function attackBriefing(campaign: AttackCampaign): string {
  return `A security campaign has been declared. This is everything the security team knows so far.

\`\`\`json
${JSON.stringify(
  {
    id: campaign.id,
    title: campaign.title,
    service: campaign.service,
    severity: campaign.severity,
    status: campaign.status,
    technique: campaign.technique,
    mitre: campaign.mitre,
    targetEndpoint: campaign.targetEndpoint,
    startedAt: campaign.startedAt,
    detectedAt: campaign.detectedAt,
    containedAt: campaign.containedAt,
    totals: campaign.totals,
    peak: campaign.peak,
    compromisedAccounts: campaign.compromised,
  },
  null,
  2,
)}
\`\`\`

Telemetry is available from 14:00 to 14:45 on the day of the campaign.

There is also an open incident, INC-4821, on this same service (payments-api) in this same window — a memory-growth/OOM problem. It is mentioned here deliberately: whether or not it is connected to this campaign is a genuine open question you should treat as one of your hypotheses and test with evidence, not assume either way.

Start by gathering the campaign telemetry — get_auth_attempts, get_attack_sources, get_security_events, get_metrics, search_logs, get_kubernetes_events and get_deployment_history — and build a timeline. Do not form a conclusion yet — just find out what the data says.`;
}

export const ATTACK_HYPOTHESIS_PROMPT = `Now generate your competing hypotheses.

Record at least three with report_hypothesis, including ones you suspect are wrong but that a careful engineer would have to rule out. For example (do not treat this as the answer, just as the kind of range to consider): per-account lockout missing on the auth endpoint, the rate limit being misconfigured or absent, the recent deploy having weakened auth in some way, the OOM restarts on this service letting sessions through some gap, or a credential leak combined with a gap in MFA enrollment. Give each an honest prior confidence based only on what you have seen so far.

Do not begin proving them yet.`;

export const ATTACK_PROVE_PROMPT = `Now test each hypothesis.

Go after them one at a time. For each, ask what evidence would have to exist if it were true, and what evidence would rule it out — then go and look for both. Record every finding with report_evidence, including the ones that eliminate a hypothesis.

When one hypothesis is supported and the others are ruled out, call report_root_cause and explain the causal chain from the weakness to the sessions and accounts affected.`;

export const ATTACK_FIX_PROMPT = `Now fix it.

Follow this sequence:
1. search_code and read_file to find the exact weakness in the source.
2. report_code_location to name the exact file, line and symbol.
3. apply_patch with the smallest correct change — add a per-account failure window and lockout, while keeping the existing per-IP behaviour and the existing tests green.
4. run_tests.

If anything fails, read the output and iterate.`;

export const ATTACK_ASSESSMENT_PROMPT = `The fix is verified. Call report_attack_assessment now with your final priority and confidence, considering how many sessions were actually created, whether the compromised account had MFA enrolled, how completely the campaign was contained, and the verified fix.`;

export function attackReportPrompt(): string {
  return `Write the security report.

Reply with the report as Markdown and nothing else — no preamble, no closing remarks. Use exactly these sections:

## Summary
ID, title, priority and confidence, in two sentences.

## Affected Service and Data
The service, the endpoint, and what data or accounts were exposed.

## Timeline
A short bulleted timeline of the campaign, with times.

## Root Cause
The causal chain, from the weakness in the code to the accounts affected.

## Code Location
The exact file, line and symbol.

## Fix
What you changed and why that fixes it.

## Verification
How you know it worked, with the test and attack-replay numbers.

## Recommended Follow-ups
Three or four specific, actionable items.`;
}
