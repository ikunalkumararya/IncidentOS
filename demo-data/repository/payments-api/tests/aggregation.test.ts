import { beforeEach, describe, expect, it } from "vitest";
import {
  aggregateTransaction,
  getAggregatedCurrencies,
  getRunningTotal,
  getTransactionCount,
  resetAggregation,
} from "../src/aggregation.js";
import type { PaymentBody } from "../src/types.js";

const body = (overrides: Partial<PaymentBody> = {}): PaymentBody => ({
  id: "txn_00000001",
  amount: 1000,
  currency: "USD",
  customerId: "cus_1",
  method: "card",
  ...overrides,
});

describe("aggregateTransaction", () => {
  beforeEach(() => resetAggregation());

  it("returns the transaction id it aggregated", () => {
    expect(aggregateTransaction(body({ id: "txn_abc" })).transactionId).toBe("txn_abc");
  });

  it("starts the running total at the first amount", () => {
    expect(aggregateTransaction(body({ amount: 750 })).runningTotal).toBe(750);
  });

  it("accumulates the running total across transactions", () => {
    aggregateTransaction(body({ amount: 1000 }));
    aggregateTransaction(body({ amount: 250 }));
    expect(getRunningTotal("USD")).toBe(1250);
  });

  it("counts transactions per currency", () => {
    aggregateTransaction(body());
    aggregateTransaction(body());
    aggregateTransaction(body());
    expect(getTransactionCount("USD")).toBe(3);
  });

  it("keeps currencies independent", () => {
    aggregateTransaction(body({ amount: 1000, currency: "USD" }));
    aggregateTransaction(body({ amount: 400, currency: "EUR" }));
    expect(getRunningTotal("USD")).toBe(1000);
    expect(getRunningTotal("EUR")).toBe(400);
  });

  it("reports zero for a currency it has not seen", () => {
    expect(getRunningTotal("JPY")).toBe(0);
    expect(getTransactionCount("JPY")).toBe(0);
  });

  it("lists aggregated currencies in a stable order", () => {
    aggregateTransaction(body({ currency: "GBP" }));
    aggregateTransaction(body({ currency: "EUR" }));
    expect(getAggregatedCurrencies()).toEqual(["EUR", "GBP"]);
  });

  it("returns the post-transaction count on each result", () => {
    aggregateTransaction(body());
    expect(aggregateTransaction(body()).count).toBe(2);
  });

  it("clears every total when the settlement period closes", () => {
    aggregateTransaction(body({ amount: 5000 }));
    resetAggregation();
    expect(getRunningTotal("USD")).toBe(0);
    expect(getAggregatedCurrencies()).toEqual([]);
  });
});
