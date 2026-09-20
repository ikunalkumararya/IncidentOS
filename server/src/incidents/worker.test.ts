import { beforeEach, expect, it, vi } from "vitest";
const { query, create } = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn() }));
vi.mock("../db/pool.js", () => ({ getPool: () => ({ query }) }));
vi.mock("../config.js", () => ({ API_KEY: "test", MODEL: "test" }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));
import { PHASES } from "./phases.js";
import { investigateNext } from "./worker.js";

/**
 * Matched by the SQL they run rather than by call position: the worker writes
 * a variable number of phase rows, so an index would be counting phases.
 */
const runs = (needle: string) => query.mock.calls.filter((call) => String(call[0]).includes(needle));
/** The failure write for this incident, not the stale-lease reclaim that also sets status='failed'. */
const FAILED = "UPDATE incoming_incidents SET status='failed', error=$1";

beforeEach(() => {
  vi.resetAllMocks();
  query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{ id: "inc-1", title: "Real website issue", service: "shop", description: "Checkout is down", evidence: [{ message: "actual evidence" }] }],
    })
    .mockResolvedValue({ rows: [], rowCount: 1 });
});

it("uses actual intake evidence and saves a review report, never marks resolved", async () => {
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "Possible cause, requires review" }] });
  await investigateNext();
  expect(create.mock.calls[0][0].messages[0].content).toContain("actual evidence");
  expect(runs("status='review'")).toHaveLength(1);
  expect(runs("status='review'")[0][0]).toContain("lease_token=$3");
  expect(runs("status='resolved'")).toHaveLength(0);
});

it("runs every phase and records one timed row for each", async () => {
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "phase output" }] });
  await investigateNext();
  expect(create).toHaveBeenCalledTimes(PHASES.length);
  expect(runs("INSERT INTO incident_phases")).toHaveLength(PHASES.length);

  const finished = runs("UPDATE incident_phases SET status='done'");
  expect(finished).toHaveLength(PHASES.length);
  // duration_ms is the measured elapsed time, so it must be a real number
  // rather than a placeholder the dashboard would render as a fake timing.
  for (const call of finished) expect(typeof call[1][1]).toBe("number");
});

it("carries each phase's findings into the next", async () => {
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "earlier finding" }] });
  await investigateNext();
  expect(create.mock.calls[0][0].messages[0].content).not.toContain("earlier finding");
  expect(create.mock.calls[1][0].messages[0].content).toContain("earlier finding");
});

it("clears a previous attempt's phases before re-running", async () => {
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "output" }] });
  await investigateNext();
  expect(runs("DELETE FROM incident_phases")).toHaveLength(1);
});

it("fails visibly on provider errors without a demo fallback", async () => {
  create.mockRejectedValue(new Error("provider failure with private detail"));
  await investigateNext();
  expect(runs(FAILED)).toHaveLength(1);
  expect(runs(FAILED)[0][1][0]).not.toContain("private detail");
  // The phase that was in flight is marked, so the dashboard shows where it stopped.
  expect(runs("UPDATE incident_phases SET status='failed'")).toHaveLength(1);
});

it("rejects truncated reports", async () => {
  create.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "text", text: "unfinished" }] });
  await investigateNext();
  expect(runs(FAILED)).toHaveLength(1);
});

it("stops quietly when another worker has taken the lease", async () => {
  create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "output" }] });
  // The renewal is the only statement keyed on (id, lease_token) alone.
  query.mockImplementation(async (sql: string) =>
    String(sql).includes("WHERE id=$1 AND lease_token=$2") ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 },
  );
  await investigateNext();
  // Losing the lease must not overwrite the progress of whoever now owns it.
  expect(runs(FAILED)).toHaveLength(0);
  expect(runs("status='review'")).toHaveLength(0);
});
