import type { Phase } from "./types";

/**
 * Fraction of the fixture timeline that should be "revealed" once a phase has
 * been reached, before accounting for progress within the phase itself. Tuned
 * so investigate (the longest phase, most tool calls) gets the biggest slice.
 */
const BASE: Record<Phase, number> = {
  investigate: 0.35,
  hypothesize: 0.55,
  prove: 0.75,
  fix: 0.9,
  verify: 1,
  report: 1,
};

const ORDER: Phase[] = ["investigate", "hypothesize", "prove", "fix", "verify", "report"];

/**
 * How much of a fixture series (logs, chart points, k8s events) to reveal
 * right now. Pure function of phase + how many tools have run in that phase,
 * so a replayed recording produces the identical reveal pacing as the run
 * that produced it.
 */
export function visibleCount(
  state: { phase: Phase | null; phaseToolCount: number; status: string },
  total: number,
): number {
  if (state.status === "idle" || state.phase === null) return 0;
  if (state.status === "resolved") return total;

  const index = ORDER.indexOf(state.phase);
  const base = Math.floor(total * BASE[state.phase]);
  const nextBase = index >= 0 && index + 1 < ORDER.length ? Math.floor(total * BASE[ORDER[index + 1]]) : total;

  const count = base + state.phaseToolCount;
  return Math.max(0, Math.min(total, Math.min(count, nextBase)));
}
