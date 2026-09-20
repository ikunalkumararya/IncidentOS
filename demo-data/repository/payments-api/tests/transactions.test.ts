import { beforeEach, describe, expect, it } from "vitest";
import { resetAggregation } from "../src/aggregation.js";
import {
  drainSettlementBatch,
  getSettlementQueueDepth,
  processPayment,
  resetTransactionCache,
} from "../src/transactions.js";
import { ValidationError } from "../src/validation.js";
import { makePaymentRequest, resetRequestCounter } from "./helpers.js";

describe("processPayment", () => {
  beforeEach(() => {
    resetTransactionCache();
    resetAggregation();
    resetRequestCounter();
  });

  it("returns the aggregation result for the captured payment", () => {
    const req = makePaymentRequest({ id: "txn_pay_1", amount: 2500 });
    const result = processPayment(req);
    expect(result.transactionId).toBe("txn_pay_1");
    expect(result.runningTotal).toBe(2500);
  });

  it("validates before capturing", () => {
    const req = makePaymentRequest({ amount: -1 });
    expect(() => processPayment(req)).toThrow(ValidationError);
  });

  it("does not queue a payment that fails validation", () => {
    expect(() => processPayment(makePaymentRequest({ currency: "CHF" as never }))).toThrow();
    expect(getSettlementQueueDepth()).toBe(0);
  });

  it("queues each captured payment for settlement", () => {
    processPayment(makePaymentRequest());
    processPayment(makePaymentRequest());
    expect(getSettlementQueueDepth()).toBe(2);
  });

  it("folds captures into the running aggregate", () => {
    processPayment(makePaymentRequest({ amount: 1000 }));
    const second = processPayment(makePaymentRequest({ amount: 500 }));
    expect(second.runningTotal).toBe(1500);
    expect(second.count).toBe(2);
  });

  it("keeps separate running totals per currency", () => {
    processPayment(makePaymentRequest({ amount: 1000, currency: "USD" }));
    const eur = processPayment(makePaymentRequest({ amount: 900, currency: "EUR" }));
    expect(eur.runningTotal).toBe(900);
  });

  it("drains every queued transaction", () => {
    processPayment(makePaymentRequest());
    processPayment(makePaymentRequest());
    processPayment(makePaymentRequest());
    expect(drainSettlementBatch()).toHaveLength(3);
  });

  it("empties the queue once drained", () => {
    processPayment(makePaymentRequest());
    drainSettlementBatch();
    expect(getSettlementQueueDepth()).toBe(0);
  });

  it("drains to an empty batch when nothing is queued", () => {
    expect(drainSettlementBatch()).toEqual([]);
  });

  it("keeps the queue usable after a drain", () => {
    processPayment(makePaymentRequest());
    drainSettlementBatch();
    processPayment(makePaymentRequest());
    expect(getSettlementQueueDepth()).toBe(1);
  });
});
