import { beforeEach, describe, expect, it } from "vitest";
import { resetAggregation } from "../src/aggregation.js";
import { peekSettlementQueue, processPayment, resetTransactionCache } from "../src/transactions.js";
import { makePaymentRequest, resetRequestCounter } from "./helpers.js";

/**
 * The settlement queue is drained on the settlement worker's schedule, not on
 * every request, so it is expected to hold a large number of entries under
 * sustained traffic. That is only safe while each entry stays small.
 *
 * This test pins the *shape* of a queued entry rather than measuring heap
 * usage, so it is deterministic and fast: if a capture ever retains the inbound
 * request — and with it the raw payload bytes and the header map — the retained
 * size per transaction jumps by three orders of magnitude and the container
 * walks into its memory limit under load.
 */
describe("settlement queue retention", () => {
  beforeEach(() => {
    resetTransactionCache();
    resetAggregation();
    resetRequestCounter();
  });

  it("retains only transaction summaries, never inbound requests", () => {
    const req = makePaymentRequest({ id: "txn_retain_1", amount: 4200, currency: "EUR" });

    processPayment(req);

    const [entry] = peekSettlementQueue() as Record<string, unknown>[];
    expect(entry, "a capture should queue exactly one settlement entry").toBeDefined();

    // The queued entry must be a derived summary, not the request itself.
    expect(entry).not.toBe(req);
    expect(Object.keys(entry).sort()).toEqual(["amount", "capturedAt", "currency", "id"]);
    expect(entry.id).toBe("txn_retain_1");
    expect(entry.amount).toBe(4200);
    expect(entry.currency).toBe("EUR");

    // Nothing reachable from the queue may hold the raw payload or the headers:
    // those are what turn a ~80-byte entry into a multi-kilobyte one.
    expect(entry.rawBody).toBeUndefined();
    expect(entry.headers).toBeUndefined();
    expect(entry.body).toBeUndefined();

    const retainedBytes = JSON.stringify(entry).length;
    expect(
      retainedBytes,
      `a settlement entry should be well under 256 bytes, got ${retainedBytes}`,
    ).toBeLessThan(256);
  });
});
