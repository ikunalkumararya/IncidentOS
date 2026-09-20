import Anthropic from "@anthropic-ai/sdk";
import { API_KEY, sandboxRepoFor } from "../config.js";
import { ATTACK_PHASE_LABELS, type Emit } from "../events.js";
import { measureAttack, prepareSandbox } from "../sandbox.js";
import { buildAttackAnalysis } from "../security/index.js";
import { ATTACK_REGISTRY } from "../tools/index.js";
import { emptyFindings, type Findings, type ToolContext } from "../tools/types.js";
import {
  attackBriefing,
  ATTACK_ASSESSMENT_PROMPT,
  ATTACK_FIX_PROMPT,
  ATTACK_HYPOTHESIS_PROMPT,
  attackReportPrompt,
  ATTACK_PROVE_PROMPT,
  ATTACK_SYSTEM_PROMPT,
} from "./attackPrompts.js";
import { createConversation, InvestigationAborted } from "./loop.js";

/**
 * Runs one attack investigation end to end. Mirrors runInvestigation's shape
 * (agent/investigator.ts) — same phased conversation, same server-side
 * verification discipline — with an attack-specific briefing, hypothesis
 * space, fix sequence and a second, replay-based verification step in place
 * of the memory measurement.
 */
export async function runAttackInvestigation(emit: Emit, signal: AbortSignal): Promise<Findings> {
  if (!API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) to run an attack investigation.",
    );
  }

  const client = new Anthropic({ apiKey: API_KEY, maxRetries: 2 });
  const { campaign } = buildAttackAnalysis();
  const findings = emptyFindings("attack");
  const root = sandboxRepoFor("attack");
  const ctx: ToolContext = { emit, findings, sandboxRoot: root };

  emit({
    type: "started",
    incidentId: campaign.id,
    message: `${campaign.severity} · ${campaign.title} · ${campaign.service}`,
    kind: "attack",
  });

  emit({ type: "narration", text: "Checking out a working copy of payments-api…" });
  await prepareSandbox("attack");

  // Baseline attack replay has to run against the unpatched code. Kick it off
  // now and collect it before the fix phase, same rationale as the incident
  // driver's baseline memory measurement.
  const baselinePromise = measureAttack(root).catch(() => null);

  const conversation = createConversation({
    client,
    systemPrompt: ATTACK_SYSTEM_PROMPT,
    registry: ATTACK_REGISTRY,
    ctx,
    emit,
    signal,
    labels: ATTACK_PHASE_LABELS,
  });
  const { runPhase } = conversation;

  const throwIfAborted = () => {
    if (signal.aborted) throw new InvestigationAborted("investigation aborted");
  };

  await runPhase({ phase: "investigate", prompt: attackBriefing(campaign) });
  await runPhase({ phase: "hypothesize", prompt: ATTACK_HYPOTHESIS_PROMPT });
  await runPhase({ phase: "prove", prompt: ATTACK_PROVE_PROMPT });

  findings.attackBefore = await baselinePromise;

  await runPhase({ phase: "fix", prompt: ATTACK_FIX_PROMPT });

  // ---------------------------------------------------------------------
  // Server-side verification, same rationale as the incident driver: these
  // are measurements taken by something with no stake in the answer.
  // ---------------------------------------------------------------------
  throwIfAborted();
  emit({ type: "phase", phase: "verify", label: ATTACK_PHASE_LABELS.verify });

  emit({
    type: "verification",
    check: "Patch applied",
    ok: findings.patches.length > 0,
    detail: findings.patches.length
      ? findings.patches.map((p) => p.path).join(", ")
      : "no patch was applied",
  });

  if (findings.patches.length && findings.attackBefore) {
    emit({ type: "narration", text: "Replaying the credential-stuffing campaign against the patched code…" });
    const after = await measureAttack(root).catch(() => null);
    findings.attackAfter = after;

    if (after) {
      const before = findings.attackBefore;
      emit({ type: "attack_sim", before, after });
      const ok = after.sessionsCreated === 0 && after.credentialsMatched < before.credentialsMatched;
      emit({
        type: "verification",
        check: "Attack replay",
        ok,
        detail:
          `${before.sessionsCreated} → ${after.sessionsCreated} sessions, ` +
          `${before.credentialsMatched} → ${after.credentialsMatched} credentials matched, ` +
          `${after.lockedAccounts} accounts locked`,
      });
    }
  }

  // A forced final turn if the model never gave its assessment on its own —
  // the console always needs a priority and confidence to show.
  if (!findings.assessment) {
    await runPhase({ phase: "verify", prompt: ATTACK_ASSESSMENT_PROMPT });
  }

  const tests = findings.tests;
  const green = Boolean(tests && tests.failed === 0 && tests.total > 0);

  if (green) {
    const markdown = await runPhase({ phase: "report", prompt: attackReportPrompt(), textOnly: true });
    if (markdown) emit({ type: "report", markdown });
    emit({ type: "resolved", durationMs: 0 });
  } else {
    emit({
      type: "error",
      message: tests
        ? `Verification incomplete: ${tests.failed} of ${tests.total} tests still failing.`
        : "Verification incomplete: the test suite was never run.",
      fatal: false,
    });
  }

  return findings;
}
